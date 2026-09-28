import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
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
  CapitalizeCipDto,
  CreateCipProjectDto,
  MarkCipReadyDto,
} from './dto/fixed-asset.dto';

const CIP_TYPE = 'CAPITAL_INVESTMENT_PROJECT';
const FIXED_ASSET_TYPE = 'FIXED_ASSET';
const ASSET_SEQUENCE_PREFIX = 'FA';

/**
 * CapitalInvestmentProject — CIP / Asset Under Construction (docx spec
 * Phase 16 section 8-9). `capitalize()` reclassifies some or all of the
 * project's accumulated cost into a brand-new FixedAsset — Dr Fixed Asset
 * Cost / Cr CIP (spec section 88) — supporting one-CIP-to-many-assets
 * (spec section 13) via repeated partial capitalization. A project can
 * only be marked CAPITALIZED once nothing capitalizable remains (spec
 * section 90: "unexplained residual" blocks closure).
 */
@Injectable()
export class CapitalInvestmentProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly accountingEngine: AccountingPostingEngine,
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
        this.prisma.capitalInvestmentProject.findMany({
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
    const row = await this.prisma.capitalInvestmentProject.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('CapitalInvestmentProject', id);
    return row;
  }

  /** Live-computed remaining capitalizable balance (never a mutable field). */
  async getRemainingBalance(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.get(tenantId, membershipId, organizationId, id);
    return this.balances.getCipBalance(tenantId, id);
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateCipProjectDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const existing = await this.prisma.capitalInvestmentProject.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (existing)
      throw new ValidationAppError(
        `CIP project code ${dto.code} already exists`,
      );

    return this.prisma.capitalInvestmentProject.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        projectType: dto.projectType,
        startDate: this.parseDate(dto.startDate),
        plannedCompletionDate: dto.plannedCompletionDate
          ? this.parseDate(dto.plannedCompletionDate)
          : undefined,
        departmentId: dto.departmentId,
        responsiblePersonId: dto.responsiblePersonId,
        locationWarehouseId: dto.locationWarehouseId,
        currencyId: dto.currencyId,
        status: 'PLANNED',
        targetAssetCount: dto.targetAssetCount,
        comment: dto.comment,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async activate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    return this.transitionStatus(
      tenantId,
      membershipId,
      organizationId,
      userId,
      id,
      expectedVersion,
      ['PLANNED', 'SUSPENDED'],
      'ACTIVE',
    );
  }

  async suspend(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    return this.transitionStatus(
      tenantId,
      membershipId,
      organizationId,
      userId,
      id,
      expectedVersion,
      ['ACTIVE'],
      'SUSPENDED',
    );
  }

  async markReady(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: MarkCipReadyDto,
  ) {
    return this.transitionStatus(
      tenantId,
      membershipId,
      organizationId,
      userId,
      id,
      dto.expectedVersion,
      ['PLANNED', 'ACTIVE', 'SUSPENDED'],
      'READY_FOR_CAPITALIZATION',
    );
  }

  private async transitionStatus(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
    allowedFrom: string[],
    to: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const project = await this.get(tenantId, membershipId, organizationId, id);
    if (!allowedFrom.includes(project.status))
      throw new ValidationAppError(
        `Cannot move CIP project from ${project.status} to ${to}`,
      );
    const result = await this.prisma.capitalInvestmentProject.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { status: to, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: `CIP_${to}`,
      entityType: CIP_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async capitalize(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: CapitalizeCipDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const project = await this.get(tenantId, membershipId, organizationId, id);
    if (project.status !== 'READY_FOR_CAPITALIZATION')
      throw new ValidationAppError(
        'CIP project must be READY_FOR_CAPITALIZATION before it can be capitalized',
      );
    if (project.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const category = await this.prisma.fixedAssetCategory.findFirst({
      where: { id: dto.categoryId, tenantId },
    });
    if (!category)
      throw new ValidationAppError('Category does not belong to this tenant');

    const businessDate = this.parseDate(dto.acceptanceDate);

    return this.prisma.runInTransaction(async (tx) => {
      // Lock BEFORE reading the balance — see FixedAssetBalanceService.lockCip.
      await this.balances.lockCip(tenantId, id, tx);
      const remaining = await this.balances.getCipBalance(
        tenantId,
        id,
        new Date(),
        tx,
      );
      const amount =
        dto.amount !== undefined
          ? new Decimal(dto.amount.toString())
          : remaining;
      if (amount.lte(0)) throw new ValidationAppError('Nothing to capitalize');
      if (amount.gt(remaining))
        throw new ValidationAppError(
          `Capitalization amount of ${amount.toFixed(2)} exceeds remaining CIP balance of ${remaining.toFixed(2)}`,
        );

      const allocated = await this.ensureAssetSequenceAndAllocate(
        tenantId,
        businessDate,
        tx,
      );
      const asset = await tx.fixedAsset.create({
        data: {
          tenantId,
          organizationId,
          assetNumber: allocated,
          name: dto.name,
          categoryId: dto.categoryId,
          cipProjectId: id,
          acquisitionDate: project.startDate,
          acceptanceDate: businessDate,
          status: 'ACCEPTED',
          initialCost: amount,
          currencyId: project.currencyId,
          departmentId: project.departmentId,
          responsiblePersonId: project.responsiblePersonId,
          locationWarehouseId: project.locationWarehouseId,
          usefulLifeMonths: category.defaultUsefulLifeMonths ?? undefined,
          depreciationMethod: category.defaultDepreciationMethod,
          residualValue: category.defaultResidualValue,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      const assetSequence = await this.balances.nextSequence(
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
          businessDate,
          movementType: 'CAPITALIZATION',
          dimensions: { organizationId, assetId: asset.id },
          resources: { costIncrease: amount.toString() },
          sequence: assetSequence,
        },
      });
      const cipSequence = await this.balances.nextSequence(
        tenantId,
        CIP_TYPE,
        id,
        tx,
      );
      await tx.registerMovement.create({
        data: {
          tenantId,
          registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
          recorderDocumentType: CIP_TYPE,
          recorderDocumentId: id,
          businessDate,
          movementType: 'CAPITALIZATION',
          dimensions: { organizationId, cipProjectId: id },
          resources: { costDecrease: amount.toString() },
          sequence: cipSequence,
        },
      });

      const costAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.FIXED_ASSET_COST,
        businessDate,
        tx,
      );
      const cipAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.FIXED_ASSET_CIP,
        businessDate,
        tx,
      );
      const capitalizeCount = await tx.journalEntry.count({
        where: {
          tenantId,
          sourceDocumentType: CIP_TYPE,
          sourceDocumentId: { startsWith: `${id}:CAPITALIZE:` },
        },
      });
      await this.accountingEngine.postBatch(
        tenantId,
        userId,
        {
          organizationId,
          businessDate,
          postingDate: businessDate,
          description: `CIP capitalization — ${project.name} → ${asset.name}`,
          operationType: 'SYSTEM_DOCUMENT',
          sourceDocumentType: CIP_TYPE,
          sourceDocumentId: `${id}:CAPITALIZE:${capitalizeCount + 1}`,
          lines: [
            {
              accountId: costAccount.id,
              side: 'DEBIT',
              amountBase: amount,
              description: `Capitalized into ${asset.name}`,
              dimensions: [
                { dimensionCode: 'FIXED_ASSET', referenceId: asset.id },
              ],
            },
            {
              accountId: cipAccount.id,
              side: 'CREDIT',
              amountBase: amount,
              description: `Capitalized out of CIP ${project.name}`,
              dimensions: [{ dimensionCode: 'CIP_PROJECT', referenceId: id }],
            },
          ],
        },
        tx,
      );

      const remainingAfter = remaining.minus(amount);
      const result = await tx.capitalInvestmentProject.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: {
          status: remainingAfter.lte(0.005)
            ? 'CAPITALIZED'
            : 'READY_FOR_CAPITALIZATION',
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'CIP_CAPITALIZED',
          entityType: CIP_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: {
            assetId: asset.id,
            amount: amount.toString(),
            remaining: remainingAfter.toString(),
          },
        },
        tx,
      );
      return {
        project: await tx.capitalInvestmentProject.findFirst({ where: { id } }),
        asset,
      };
    });
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
