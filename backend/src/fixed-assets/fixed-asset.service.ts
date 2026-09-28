import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  FixedAssetBalanceService,
  FIXED_ASSET_MOVEMENT_REGISTER,
} from './fixed-asset-balance.service';
import {
  AcceptFixedAssetDto,
  ChangeUsefulLifeDto,
  CommissionFixedAssetDto,
  CreateFixedAssetDto,
  CreateOpeningBalanceDto,
  TransferFixedAssetDto,
} from './dto/fixed-asset.dto';

const FIXED_ASSET_TYPE = 'FIXED_ASSET';
const ASSET_SEQUENCE_PREFIX = 'FA';

/**
 * FixedAssetService — the card (docx spec Phase 16 section 15) plus its
 * own lifecycle actions that are NOT full document-framework participants
 * (accept/commission/transfer/useful-life-change never touch the GL by
 * themselves, so they don't need post/unpost — only Modernization/
 * Impairment/Disposal do, see their own services).
 *
 * Acceptance != Commissioning (spec section 19): accepting only registers
 * the asset; depreciation eligibility only begins at commissioning, per
 * `depreciationStartRule` (spec section 20).
 */
@Injectable()
export class FixedAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    status?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.fixedAsset.findMany({
          where: { organizationId, ...(status ? { status } : {}) },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAsset.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('FixedAsset', id);
    return row;
  }

  async getWithBalances(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    const asset = await this.get(tenantId, membershipId, organizationId, id);
    const balances = await this.balances.getBalances(tenantId, id);
    return {
      ...asset,
      grossCost: balances.grossCost.toFixed(2),
      accumulatedDepreciation: balances.accumulatedDepreciation.toFixed(2),
      accumulatedImpairment: balances.accumulatedImpairment.toFixed(2),
      netBookValue: balances.netBookValue.toFixed(2),
    };
  }

  /** Manual/migration creation — no GL posting (see docs/FIXED_ASSETS.md:
   * acquisition-candidate/CIP capitalization are the GL-affecting paths;
   * this is for admin entry or as the base for FixedAssetOpeningBalance). */
  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateFixedAssetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const category = await this.prisma.fixedAssetCategory.findFirst({
      where: { id: dto.categoryId, tenantId },
    });
    if (!category)
      throw new ValidationAppError('Category does not belong to this tenant');
    const initialCost = new Decimal(dto.initialCost.toString());
    if (!initialCost.isFinite() || initialCost.lte(0))
      throw new ValidationAppError('initialCost must be positive');

    const acquisitionDate = this.parseDate(dto.acquisitionDate);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.ensureAssetSequenceAndAllocate(
        tenantId,
        acquisitionDate,
        tx,
      );
      const asset = await tx.fixedAsset.create({
        data: {
          tenantId,
          organizationId,
          assetNumber: allocated,
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId,
          acquisitionDate,
          initialCost,
          currencyId: dto.currencyId,
          serialNumber: dto.serialNumber,
          manufacturer: dto.manufacturer,
          model: dto.model,
          usefulLifeMonths: category.defaultUsefulLifeMonths ?? undefined,
          depreciationMethod: category.defaultDepreciationMethod,
          residualValue: category.defaultResidualValue,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      const sequence = await this.balances.nextSequence(
        tenantId,
        FIXED_ASSET_TYPE,
        asset.id,
        tx,
      );
      await tx.registerMovement.create({
        data: {
          tenantId,
          registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
          recorderDocumentType: FIXED_ASSET_TYPE,
          recorderDocumentId: asset.id,
          businessDate: acquisitionDate,
          movementType: 'INITIAL_RECOGNITION',
          dimensions: { organizationId, assetId: asset.id },
          resources: { costIncrease: initialCost.toString() },
          sequence,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_CREATED',
          entityType: FIXED_ASSET_TYPE,
          entityId: asset.id,
          action: 'CREATE',
          userId,
          newValues: {
            assetNumber: asset.assetNumber,
            initialCost: initialCost.toString(),
          },
        },
        tx,
      );
      return asset;
    });
  }

  /** FixedAssetOpeningBalance (spec sections 76-77) — migration entity.
   * Deliberately does NOT post GL: a migrated opening balance is assumed
   * to already be part of the tenant's own opening trial balance (the
   * same convention Accounting Core's own opening-balance docs use),
   * this only seeds the FA subledger (register movements) so future
   * depreciation/disposal/health/reconciliation see a consistent history
   * from day one. */
  async createOpeningBalance(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateOpeningBalanceDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const category = await this.prisma.fixedAssetCategory.findFirst({
      where: { id: dto.categoryId, tenantId },
    });
    if (!category)
      throw new ValidationAppError('Category does not belong to this tenant');
    const originalCost = new Decimal(dto.originalCost.toString());
    const accumulatedDepreciation = new Decimal(
      dto.accumulatedDepreciation?.toString() ?? '0',
    );
    const impairment = new Decimal(dto.impairment?.toString() ?? '0');
    if (accumulatedDepreciation.plus(impairment).gt(originalCost))
      throw new ValidationAppError(
        'Accumulated depreciation + impairment cannot exceed original cost',
      );

    const openingDate = this.parseDate(dto.openingDate);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.ensureAssetSequenceAndAllocate(
        tenantId,
        openingDate,
        tx,
      );
      const asset = await tx.fixedAsset.create({
        data: {
          tenantId,
          organizationId,
          assetNumber: allocated,
          name: dto.name,
          categoryId: dto.categoryId,
          acquisitionDate: openingDate,
          acceptanceDate: openingDate,
          commissioningDate: openingDate,
          depreciationStartDate: openingDate,
          status: 'ACTIVE',
          initialCost: originalCost,
          currencyId: dto.currencyId,
          departmentId: dto.departmentId,
          locationWarehouseId: dto.locationWarehouseId,
          responsiblePersonId: dto.responsiblePersonId,
          usefulLifeMonths: dto.remainingUsefulLifeMonths,
          depreciationMethod: category.defaultDepreciationMethod,
          residualValue:
            dto.residualValue !== undefined
              ? new Decimal(dto.residualValue.toString())
              : category.defaultResidualValue,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await tx.fixedAssetOpeningBalance.create({
        data: {
          tenantId,
          assetId: asset.id,
          openingDate,
          originalCost,
          accumulatedDepreciation,
          impairment,
          remainingUsefulLifeMonths: dto.remainingUsefulLifeMonths,
          createdBy: userId,
        },
      });

      const sequence = await this.balances.nextSequence(
        tenantId,
        FIXED_ASSET_TYPE,
        asset.id,
        tx,
      );
      await tx.registerMovement.create({
        data: {
          tenantId,
          registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
          recorderDocumentType: FIXED_ASSET_TYPE,
          recorderDocumentId: asset.id,
          businessDate: openingDate,
          movementType: 'OPENING_BALANCE',
          dimensions: { organizationId, assetId: asset.id },
          resources: {
            costIncrease: originalCost.toString(),
            depreciationIncrease: accumulatedDepreciation.toString(),
            impairmentIncrease: impairment.toString(),
          },
          sequence,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_OPENING_BALANCE_CREATED',
          entityType: FIXED_ASSET_TYPE,
          entityId: asset.id,
          action: 'CREATE',
          userId,
          newValues: {
            originalCost: originalCost.toString(),
            accumulatedDepreciation: accumulatedDepreciation.toString(),
          },
        },
        tx,
      );
      return asset;
    });
  }

  async accept(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: AcceptFixedAssetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.get(tenantId, membershipId, organizationId, id);
    if (!['ACQUISITION', 'UNDER_CONSTRUCTION'].includes(asset.status))
      throw new ValidationAppError(
        `Cannot accept an asset in status ${asset.status}`,
      );
    if (asset.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const result = await this.prisma.fixedAsset.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        status: 'ACCEPTED',
        acceptanceDate: this.parseDate(dto.acceptanceDate),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'FIXED_ASSET_ACCEPTED',
      entityType: FIXED_ASSET_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { acceptanceDate: dto.acceptanceDate },
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async commission(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: CommissionFixedAssetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.get(tenantId, membershipId, organizationId, id);
    if (asset.status !== 'ACCEPTED')
      throw new ValidationAppError(
        `Cannot commission an asset in status ${asset.status} — accept it first`,
      );
    if (asset.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const commissioningDate = this.parseDate(dto.commissioningDate);
    const depreciationStartRule =
      dto.depreciationStartRule ?? 'FIRST_DAY_NEXT_MONTH';
    const depreciationStartDate = this.computeDepreciationStartDate(
      commissioningDate,
      depreciationStartRule,
    );

    const result = await this.prisma.fixedAsset.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        status: 'ACTIVE',
        commissioningDate,
        depreciationStartDate,
        depreciationStartRule,
        departmentId: dto.departmentId,
        locationWarehouseId: dto.locationWarehouseId,
        responsiblePersonId: dto.responsiblePersonId,
        usefulLifeMonths: dto.usefulLifeMonths,
        depreciationMethod: dto.depreciationMethod ?? asset.depreciationMethod,
        residualValue:
          dto.residualValue !== undefined
            ? new Decimal(dto.residualValue.toString())
            : asset.residualValue,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'FIXED_ASSET_COMMISSIONED',
      entityType: FIXED_ASSET_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: {
        commissioningDate: dto.commissioningDate,
        depreciationStartDate: depreciationStartDate.toISOString().slice(0, 10),
        usefulLifeMonths: dto.usefulLifeMonths,
      },
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async transfer(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: TransferFixedAssetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.get(tenantId, membershipId, organizationId, id);
    if (asset.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status))
      throw new ValidationAppError(`Cannot transfer a ${asset.status} asset`);

    const effectiveDate = this.parseDate(dto.effectiveDate);

    return this.prisma.runInTransaction(async (tx) => {
      await tx.fixedAssetTransfer.create({
        data: {
          tenantId,
          organizationId,
          assetId: id,
          effectiveDate,
          fromDepartmentId: asset.departmentId,
          toDepartmentId: dto.toDepartmentId ?? asset.departmentId,
          fromLocationWarehouseId: asset.locationWarehouseId,
          toLocationWarehouseId:
            dto.toLocationWarehouseId ?? asset.locationWarehouseId,
          fromResponsiblePersonId: asset.responsiblePersonId,
          toResponsiblePersonId:
            dto.toResponsiblePersonId ?? asset.responsiblePersonId,
          reason: dto.reason,
          createdBy: userId,
        },
      });

      const result = await tx.fixedAsset.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: {
          departmentId: dto.toDepartmentId ?? asset.departmentId,
          locationWarehouseId:
            dto.toLocationWarehouseId ?? asset.locationWarehouseId,
          responsiblePersonId:
            dto.toResponsiblePersonId ?? asset.responsiblePersonId,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_TRANSFERRED',
          entityType: FIXED_ASSET_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: {
            effectiveDate: dto.effectiveDate,
            toDepartmentId: dto.toDepartmentId,
            toLocationWarehouseId: dto.toLocationWarehouseId,
            toResponsiblePersonId: dto.toResponsiblePersonId,
          },
        },
        tx,
      );
      return tx.fixedAsset.findFirst({ where: { id } });
    });
  }

  /** Useful life / residual value / method change (spec sections 35-37) —
   * ALWAYS prospective: this write creates a checkpoint the depreciation
   * engine picks up for future periods only, never rewriting past ones. */
  async changeUsefulLife(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ChangeUsefulLifeDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.get(tenantId, membershipId, organizationId, id);
    if (asset.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();
    if (!asset.commissioningDate)
      throw new ValidationAppError(
        'Cannot change useful life before the asset is commissioned',
      );
    if (
      dto.newUsefulLifeMonths === undefined &&
      dto.newResidualValue === undefined
    )
      throw new ValidationAppError('Nothing to change');

    const effectiveDate = this.parseDate(dto.effectiveDate);

    return this.prisma.runInTransaction(async (tx) => {
      await tx.fixedAssetPolicyChange.create({
        data: {
          tenantId,
          assetId: id,
          effectiveDate,
          oldUsefulLifeMonths: asset.usefulLifeMonths,
          newUsefulLifeMonths:
            dto.newUsefulLifeMonths ?? asset.usefulLifeMonths,
          oldResidualValue: asset.residualValue,
          newResidualValue:
            dto.newResidualValue !== undefined
              ? new Decimal(dto.newResidualValue.toString())
              : asset.residualValue,
          reason: dto.reason,
          createdBy: userId,
        },
      });

      const result = await tx.fixedAsset.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: {
          usefulLifeMonths: dto.newUsefulLifeMonths ?? asset.usefulLifeMonths,
          residualValue:
            dto.newResidualValue !== undefined
              ? new Decimal(dto.newResidualValue.toString())
              : asset.residualValue,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_USEFUL_LIFE_CHANGED',
          entityType: FIXED_ASSET_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: {
            effectiveDate: dto.effectiveDate,
            newUsefulLifeMonths: dto.newUsefulLifeMonths,
            newResidualValue: dto.newResidualValue,
          },
        },
        tx,
      );
      return tx.fixedAsset.findFirst({ where: { id } });
    });
  }

  private computeDepreciationStartDate(
    commissioningDate: Date,
    rule: string,
  ): Date {
    const d = new Date(commissioningDate);
    switch (rule) {
      case 'FROM_COMMISSIONING_DATE':
        return d;
      case 'NEXT_DAY': {
        const next = new Date(d);
        next.setUTCDate(next.getUTCDate() + 1);
        return next;
      }
      case 'NEXT_MONTH':
      case 'FIRST_DAY_NEXT_MONTH':
      default: {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      }
    }
  }

  private async ensureAssetSequenceAndAllocate(
    tenantId: string,
    businessDate: Date,
    tx: PrismaTransactionClient,
  ): Promise<string> {
    const sequence = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: FIXED_ASSET_TYPE } },
    });
    if (!sequence) {
      try {
        await this.prisma.numberSequence.create({
          data: {
            tenantId,
            code: FIXED_ASSET_TYPE,
            documentType: FIXED_ASSET_TYPE,
            prefix: ASSET_SEQUENCE_PREFIX,
            padding: 6,
            resetPolicy: 'NEVER',
          },
        });
      } catch {
        // Lost the race — fine.
      }
    }
    const allocated = await this.numbering.allocateNumber(
      tenantId,
      FIXED_ASSET_TYPE,
      businessDate,
      tx,
    );
    return allocated.formatted;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
