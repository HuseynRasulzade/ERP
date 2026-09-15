import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { FixedAssetMovementService } from './fixed-asset-movement.service';

/**
 * FixedAssetOpeningBalanceService (spec sections 76-77) — migration-only:
 * creates a fully-ACTIVE FixedAsset directly (skipping ACQUISITION/
 * ACCEPTED) with an OPENING_BALANCE movement carrying the migrated cost/
 * accumulated depreciation/impairment/revaluation in one shot. No GL
 * posting here (an opening balance's GL side belongs to the general
 * opening-balance/migration process from Phase 4, not duplicated here) —
 * only the fixed-asset subledger is seeded so reporting is correct from
 * day one; reconciling that subledger total against the GL opening
 * balance is the caller's job (spec section 77), surfaced by
 * `FixedAssetReconciliationService`.
 */
@Injectable()
export class FixedAssetOpeningBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly movements: FixedAssetMovementService,
  ) {}

  async migrate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: {
      name: string;
      categoryId: string;
      currencyId: string;
      openingDate: string;
      originalCost: number;
      accumulatedDepreciation?: number;
      impairment?: number;
      revaluation?: number;
      remainingUsefulLifeMonths?: number;
      usefulLifeMonths?: number;
      depreciationMethod?: string;
      residualValue?: number;
      commissioningDate?: string;
      departmentId?: string;
      responsiblePersonId?: string;
      locationId?: string;
      serialNumber?: string;
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.originalCost <= 0) throw new ValidationAppError('originalCost must be positive');
    const openingDate = this.parseDate(dto.openingDate);
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: 'FIXED_ASSET' } } });
    if (!existing) {
      try {
        await this.prisma.numberSequence.create({ data: { tenantId, code: 'FIXED_ASSET', documentType: 'FIXED_ASSET', prefix: 'FA', padding: 6, resetPolicy: 'YEARLY' } });
      } catch {
        // Lost the race — fine.
      }
    }

    return this.prisma.runInTransaction(async (tx) => {
      const assetNumber = await this.numbering.allocateNumber(tenantId, 'FIXED_ASSET', openingDate, tx);
      const initialCost = new Decimal(dto.originalCost);
      const accumulatedDepreciation = new Decimal(dto.accumulatedDepreciation ?? 0);
      const impairment = new Decimal(dto.impairment ?? 0);
      const revaluation = new Decimal(dto.revaluation ?? 0);
      const carryingAmount = initialCost.minus(accumulatedDepreciation).minus(impairment).plus(revaluation);

      const asset = await tx.fixedAsset.create({
        data: {
          tenantId,
          organizationId,
          assetNumber: assetNumber.formatted,
          name: dto.name,
          categoryId: dto.categoryId,
          currencyId: dto.currencyId,
          acquisitionDate: openingDate,
          acceptanceDate: openingDate,
          commissioningDate: dto.commissioningDate ? this.parseDate(dto.commissioningDate) : openingDate,
          departmentId: dto.departmentId,
          responsiblePersonId: dto.responsiblePersonId,
          locationId: dto.locationId,
          serialNumber: dto.serialNumber,
          usefulLifeMonths: dto.usefulLifeMonths,
          remainingUsefulLifeMonths: dto.remainingUsefulLifeMonths ?? dto.usefulLifeMonths,
          depreciationMethod: dto.depreciationMethod ?? 'STRAIGHT_LINE',
          residualValue: (dto.residualValue ?? 0).toString(),
          status: 'ACTIVE',
          initialCost: '0', // seeded below via the OPENING_BALANCE movement, never set directly
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.movements.record(tenantId, { organizationId, assetId: asset.id, movementType: 'OPENING_BALANCE', costIncrease: initialCost, depreciationIncrease: accumulatedDepreciation.gt(0) ? accumulatedDepreciation : undefined, impairmentIncrease: impairment.gt(0) ? impairment : undefined, revaluationIncrease: revaluation.gt(0) ? revaluation : undefined, sourceDocumentType: 'FIXED_ASSET_OPENING_BALANCE', sourceDocumentId: asset.id, effectiveDate: openingDate }, tx);

      const balance = await tx.fixedAssetOpeningBalance.create({
        data: { tenantId, assetId: asset.id, openingDate, originalCost: initialCost.toString(), accumulatedDepreciation: accumulatedDepreciation.toString(), impairment: impairment.toString(), revaluation: revaluation.toString(), remainingUsefulLifeMonths: dto.remainingUsefulLifeMonths ?? dto.usefulLifeMonths, createdBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_OPENING_BALANCE_MIGRATED', entityType: 'FIXED_ASSET', entityId: asset.id, action: 'CREATE', userId, newValues: { originalCost: dto.originalCost, carryingAmount: carryingAmount.toString() } }, tx);
      return { asset, openingBalance: balance };
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
