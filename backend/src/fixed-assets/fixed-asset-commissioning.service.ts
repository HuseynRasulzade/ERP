import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import {
  AssetStatus,
  BOOK_CODES,
  Books,
  FaDocumentType,
  IN_USE_STATUSES,
  MovementType,
  dec,
  isoDate,
  periodOf,
  toDate,
} from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { DepreciationStrategyRegistry } from './depreciation/depreciation-strategies';
import { validateAssignmentRefs } from './fixed-asset-references';
import { FixedAssetInvalidStateError, FixedAssetPolicyViolationError } from './fixed-asset.errors';

export interface CommissionDto {
  date: string;
  departmentId?: string;
  locationId?: string;
  responsiblePersonId?: string;
  branchId?: string;
  costCenterId?: string;
  projectId?: string;
  expenseType?: string;
  usefulLifeMonths?: number;
  depreciationMethod?: string;
  residualValue?: number;
  depreciationRate?: number;
  depreciationStartRule?: string;
  partialPeriodRule?: string;
  taxBook?: { usefulLifeMonths: number; depreciationMethod?: string; residualValue?: number; depreciationRate?: number };
  description?: string;
}

/**
 * FixedAssetCommissioningService (spec sections 18-20, 35-37, 51, 75, 133,
 * 137): putting an accepted asset into use (the ONLY event that creates
 * depreciation eligibility), prospective parameter changes (useful life /
 * residual / method) as effective-dated book-policy versions, and
 * suspension / conservation / held-for-sale status changes.
 */
@Injectable()
export class FixedAssetCommissioningService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly documents: FixedAssetDocumentService,
    private readonly history: FixedAssetHistoryService,
    private readonly policies: DepreciationPolicyService,
    private readonly strategies: DepreciationStrategyRegistry,
  ) {}

  onModuleInit() {
    this.documents.registerReversalHook(FaDocumentType.COMMISSIONING, async (tx, doc) => {
      for (const line of doc.lines) {
        await tx.fixedAsset.update({ where: { id: line.assetId }, data: { commissioningDate: null, depreciationStartDate: null } });
      }
    });
  }

  async commission(tenantId: string, membershipId: string, organizationId: string, assetId: string, userId: string, dto: CommissionDto) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.COMMISSIONING);
    const date = toDate(dto.date);

    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (asset.status === AssetStatus.ACQUISITION) {
        throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} cannot be commissioned because initial cost formation is incomplete (it has not been accepted yet).`);
      }
      if (asset.status !== AssetStatus.ACCEPTED && asset.status !== AssetStatus.NOT_COMMISSIONED) {
        throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; only an accepted, not yet commissioned asset can be commissioned.`);
      }
      if (asset.acceptanceDate && date.getTime() < asset.acceptanceDate.getTime()) {
        throw new ValidationAppError(`Commissioning date ${isoDate(date)} is before the acceptance date ${isoDate(asset.acceptanceDate)}`);
      }
      await validateAssignmentRefs(tx, tenantId, organizationId, dto);
      const category = asset.category;
      const policy = await this.policies.resolvePolicy(tenantId, organizationId, category.id, date, Books.ACCOUNTING_BOOK, tx);
      const balances = await this.ledger.balances(tenantId, assetId, { tx });

      // Category values are DEFAULTS, frozen here onto the asset's own book
      // policy — later category edits never touch this asset (section 79).
      const usefulLife = dto.usefulLifeMonths ?? category.defaultUsefulLifeMonths ?? null;
      const method = dto.depreciationMethod ?? category.defaultDepreciationMethod;
      const residual =
        dto.residualValue !== undefined
          ? dec(dto.residualValue)
          : category.defaultResidualPercent
            ? balances.grossCarrying.mul(dec(category.defaultResidualPercent)).div(100).toDecimalPlaces(2)
            : dec(category.defaultResidualValue);
      const startRule = dto.depreciationStartRule ?? category.defaultDepreciationStartRule ?? policy.depreciationStartRule;
      const partialRule = dto.partialPeriodRule ?? category.defaultPartialPeriodRule ?? policy.partialPeriodRule;
      if (residual.lt(0) || residual.gte(balances.grossCarrying)) {
        throw new FixedAssetPolicyViolationError(`Residual value ${residual.toFixed(2)} is invalid for asset ${asset.assetNumber} with cost ${balances.grossCarrying.toFixed(2)}.`);
      }
      if (usefulLife !== null && usefulLife <= 0) throw new ValidationAppError('Useful life must be positive');
      if (!this.strategies.supported().includes(method)) {
        throw new FixedAssetPolicyViolationError(`Depreciation method ${method} is not supported yet; supported: ${this.strategies.supported().join(', ')}.`);
      }
      const depreciationStartDate = this.policies.depreciationStartDate(date, startRule);
      const expenseType = dto.expenseType ?? asset.expenseType ?? category.defaultExpenseType;

      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.COMMISSIONING,
        documentDate: date,
        userId,
        description: dto.description ?? `Commissioning of ${asset.assetNumber} ${asset.name}`,
        payload: { depreciationStartRule: startRule, partialPeriodRule: partialRule, depreciationStartDate: isoDate(depreciationStartDate), expenseType, taxBook: dto.taxBook ?? null },
        lines: [
          {
            assetId,
            costBefore: balances.cost.toString(),
            carryingAmountBefore: balances.netBookValue.toString(),
            carryingAmountAfter: balances.netBookValue.toString(),
            usefulLifeAfter: usefulLife,
            remainingLifeAfter: usefulLife,
            residualAfter: residual.toString(),
            methodAfter: method,
            statusBefore: asset.status,
            statusAfter: AssetStatus.ACTIVE,
            fromDepartmentId: asset.departmentId,
            toDepartmentId: dto.departmentId ?? asset.departmentId,
            fromLocationId: asset.locationId,
            toLocationId: dto.locationId ?? asset.locationId,
            fromResponsiblePersonId: asset.responsiblePersonId,
            toResponsiblePersonId: dto.responsiblePersonId ?? asset.responsiblePersonId,
            toCostCenterId: dto.costCenterId,
          },
        ],
      });

      await this.policies.createBookPolicy(tx, {
        tenantId,
        assetId,
        bookCode: Books.ACCOUNTING_BOOK,
        effectiveDate: depreciationStartDate,
        usefulLifeMonths: usefulLife,
        remainingLifeMonths: usefulLife,
        residualValue: residual,
        depreciationMethod: method,
        depreciationRate: dto.depreciationRate ?? null,
        depreciationStartRule: startRule,
        partialPeriodRule: partialRule,
        changeReason: 'Commissioning',
        sourceDocumentType: FaDocumentType.COMMISSIONING,
        sourceDocumentId: doc.id,
        createdBy: userId,
      });
      if (dto.taxBook) {
        await this.policies.createBookPolicy(tx, {
          tenantId,
          assetId,
          bookCode: Books.TAX_BOOK,
          effectiveDate: depreciationStartDate,
          usefulLifeMonths: dto.taxBook.usefulLifeMonths,
          remainingLifeMonths: dto.taxBook.usefulLifeMonths,
          residualValue: dto.taxBook.residualValue ?? 0,
          depreciationMethod: dto.taxBook.depreciationMethod ?? method,
          depreciationRate: dto.taxBook.depreciationRate ?? null,
          depreciationStartRule: startRule,
          partialPeriodRule: partialRule,
          changeReason: 'Commissioning (tax book)',
          sourceDocumentType: FaDocumentType.COMMISSIONING,
          sourceDocumentId: doc.id,
          createdBy: userId,
        });
      }

      await this.history.assign(tx, {
        tenantId,
        assetId,
        validFrom: date,
        values: { departmentId: dto.departmentId, locationId: dto.locationId, responsiblePersonId: dto.responsiblePersonId, branchId: dto.branchId, costCenterId: dto.costCenterId, projectId: dto.projectId, expenseType },
        sourceDocumentType: FaDocumentType.COMMISSIONING,
        sourceDocumentId: doc.id,
        createdBy: userId,
      });
      await this.ledger.write(tx, {
        tenantId,
        organizationId,
        assetId,
        movementType: MovementType.COMMISSIONING,
        businessDate: date,
        departmentId: dto.departmentId ?? asset.departmentId,
        locationId: dto.locationId ?? asset.locationId,
        sourceDocumentType: FaDocumentType.COMMISSIONING,
        sourceDocumentId: doc.id,
        sourceDocumentLineId: doc.lines[0].id,
        description: 'Commissioning (put into use)',
        createdBy: userId,
      });
      await tx.fixedAsset.update({ where: { id: assetId }, data: { status: AssetStatus.ACTIVE, commissioningDate: date, depreciationStartDate, updatedBy: userId } });
      await this.history.recordParameter(tx, { tenantId, assetId, parameterCode: 'status', oldValue: asset.status, newValue: AssetStatus.ACTIVE, effectiveDate: date, sourceDocumentType: FaDocumentType.COMMISSIONING, sourceDocumentId: doc.id, createdBy: userId });
      await this.policies.reprojectParameters(tx, tenantId, assetId);
      await this.ledger.refreshProjection(tx, tenantId, assetId);
      await this.audit.record(
        {
          tenantId,
          eventType: 'FixedAssetCommissioned',
          entityType: 'FixedAsset',
          entityId: assetId,
          action: 'COMMISSION',
          userId,
          oldValues: { status: asset.status },
          newValues: { status: AssetStatus.ACTIVE, commissioningDate: isoDate(date), depreciationStartDate: isoDate(depreciationStartDate), usefulLife, method, residual: residual.toString(), documentId: doc.id },
        },
        tx,
      );
      return doc;
    });
  }

  /**
   * Useful life / residual value / method change (spec sections 35-37):
   * a NEW effective-dated book-policy version — the old one is kept, past
   * periods are untouched, future depreciation is recalculated prospectively.
   * A change landing in an already-depreciated period is refused (reverse
   * that period's depreciation first).
   */
  async changeParameters(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    assetId: string,
    userId: string,
    dto: { effectiveDate: string; bookCode?: string; usefulLifeMonths?: number; remainingUsefulLifeMonths?: number; residualValue?: number; depreciationMethod?: string; depreciationRate?: number; reason: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.PARAMETER_CHANGE);
    const date = toDate(dto.effectiveDate);
    const book = dto.bookCode ?? Books.ACCOUNTING_BOOK;
    if (!BOOK_CODES.includes(book as any)) throw new ValidationAppError(`Unknown book ${book}`);

    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (!IN_USE_STATUSES.includes(asset.status)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; parameters can only change for a commissioned asset.`);
      const current = await this.policies.latestBookPolicy(tenantId, assetId, book, tx);
      if (!current) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} has no ${book} depreciation parameters yet.`);
      const effectivePeriod = periodOf(date) > current.effectivePeriod ? periodOf(date) : current.effectivePeriod;
      const alreadyDone = await tx.fixedAssetDepreciationLine.findFirst({ where: { tenantId, assetId, bookCode: book, status: 'POSTED', period: { gte: effectivePeriod } }, orderBy: { period: 'desc' } });
      if (alreadyDone) {
        throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is already depreciated for ${alreadyDone.period}; a parameter change effective ${effectivePeriod} would rewrite history. Reverse that depreciation first or choose a later effective date.`);
      }
      const remainingNow = (await this.policies.remainingLifeAt(tenantId, assetId, book, current, effectivePeriod, tx)) ?? current.usefulLifeMonths ?? 0;
      const elapsed = (current.usefulLifeMonths ?? remainingNow) - remainingNow;
      let newRemaining = remainingNow;
      if (dto.remainingUsefulLifeMonths !== undefined) newRemaining = dto.remainingUsefulLifeMonths;
      else if (dto.usefulLifeMonths !== undefined) newRemaining = dto.usefulLifeMonths - elapsed;
      if (newRemaining <= 0) throw new ValidationAppError(`New useful life leaves no remaining life (elapsed ${elapsed} months)`);
      const newTotal = elapsed + newRemaining;
      const residual = dto.residualValue !== undefined ? dec(dto.residualValue) : dec(current.residualValue);
      const balances = await this.ledger.balances(tenantId, assetId, { tx, book });
      if (residual.lt(0) || residual.gte(balances.grossCarrying)) throw new FixedAssetPolicyViolationError(`Residual value ${residual.toFixed(2)} is invalid for cost ${balances.grossCarrying.toFixed(2)}.`);
      const method = dto.depreciationMethod ?? current.depreciationMethod;
      if (!this.strategies.supported().includes(method)) throw new FixedAssetPolicyViolationError(`Depreciation method ${method} is not supported yet.`);

      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.PARAMETER_CHANGE,
        documentDate: date,
        userId,
        reason: dto.reason,
        bookCode: book,
        description: `Depreciation parameter change ${asset.assetNumber}`,
        lines: [
          {
            assetId,
            usefulLifeBefore: current.usefulLifeMonths,
            usefulLifeAfter: newTotal,
            remainingLifeBefore: remainingNow,
            remainingLifeAfter: newRemaining,
            residualBefore: current.residualValue.toString(),
            residualAfter: residual.toString(),
            methodBefore: current.depreciationMethod,
            methodAfter: method,
            carryingAmountBefore: balances.netBookValue.toString(),
            carryingAmountAfter: balances.netBookValue.toString(),
          },
        ],
      });
      await this.policies.createBookPolicy(tx, {
        tenantId,
        assetId,
        bookCode: book,
        effectiveDate: date,
        effectivePeriod,
        usefulLifeMonths: newTotal,
        remainingLifeMonths: newRemaining,
        residualValue: residual,
        depreciationMethod: method,
        depreciationRate: dto.depreciationRate ?? current.depreciationRate,
        depreciationStartRule: current.depreciationStartRule,
        partialPeriodRule: current.partialPeriodRule,
        changeReason: dto.reason,
        sourceDocumentType: FaDocumentType.PARAMETER_CHANGE,
        sourceDocumentId: doc.id,
        createdBy: userId,
      });
      await this.ledger.write(tx, { tenantId, organizationId, assetId, bookCode: book, movementType: MovementType.PARAMETER_CHANGE, businessDate: date, sourceDocumentType: FaDocumentType.PARAMETER_CHANGE, sourceDocumentId: doc.id, description: dto.reason, createdBy: userId });
      const base = { tenantId, assetId, effectiveDate: date, sourceDocumentType: FaDocumentType.PARAMETER_CHANGE, sourceDocumentId: doc.id, reason: dto.reason, createdBy: userId };
      await this.history.recordParameter(tx, { ...base, parameterCode: `${book}.usefulLifeMonths`, oldValue: current.usefulLifeMonths, newValue: newTotal });
      await this.history.recordParameter(tx, { ...base, parameterCode: `${book}.remainingLifeMonths`, oldValue: remainingNow, newValue: newRemaining });
      await this.history.recordParameter(tx, { ...base, parameterCode: `${book}.residualValue`, oldValue: dec(current.residualValue).toFixed(2), newValue: residual.toFixed(2) });
      await this.history.recordParameter(tx, { ...base, parameterCode: `${book}.depreciationMethod`, oldValue: current.depreciationMethod, newValue: method });
      if (book === Books.ACCOUNTING_BOOK) await this.policies.reprojectParameters(tx, tenantId, assetId);
      await tx.fixedAsset.update({ where: { id: assetId }, data: { version: { increment: 1 } } });
      await this.audit.record(
        {
          tenantId,
          eventType: method !== current.depreciationMethod ? 'FIXED_ASSET_DEPRECIATION_METHOD_CHANGED' : 'FIXED_ASSET_USEFUL_LIFE_CHANGED',
          entityType: 'FixedAsset',
          entityId: assetId,
          action: 'CHANGE_PARAMETERS',
          userId,
          oldValues: { usefulLifeMonths: current.usefulLifeMonths, remaining: remainingNow, residual: current.residualValue.toString(), method: current.depreciationMethod },
          newValues: { usefulLifeMonths: newTotal, remaining: newRemaining, residual: residual.toString(), method, effectivePeriod, documentId: doc.id },
          reason: dto.reason,
        },
        tx,
      );
      return doc;
    });
  }

  /** Suspension / conservation / held-for-sale / resume (spec sections 51, 75). */
  async changeStatus(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    assetId: string,
    userId: string,
    dto: { status: string; date: string; reason: string; depreciationPolicy?: string; endDate?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.STATUS_CHANGE);
    const allowedTargets = [AssetStatus.SUSPENDED, AssetStatus.CONSERVED, AssetStatus.HELD_FOR_SALE, AssetStatus.ACTIVE];
    if (!allowedTargets.includes(dto.status as any)) throw new ValidationAppError(`Status ${dto.status} cannot be set directly`);
    if (dto.depreciationPolicy && !['CONTINUE_DEPRECIATION', 'PAUSE_DEPRECIATION', 'LOCALIZATION_RULE'].includes(dto.depreciationPolicy)) {
      throw new ValidationAppError(`Unknown depreciation policy ${dto.depreciationPolicy}`);
    }
    const date = toDate(dto.date);
    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      const from = asset.status;
      const ok =
        dto.status === AssetStatus.ACTIVE
          ? [AssetStatus.SUSPENDED, AssetStatus.CONSERVED, AssetStatus.HELD_FOR_SALE].includes(from as any)
          : [AssetStatus.ACTIVE, AssetStatus.SUSPENDED, AssetStatus.CONSERVED].includes(from as any) && from !== dto.status;
      if (!ok) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} cannot change from ${from} to ${dto.status}.`);
      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.STATUS_CHANGE,
        documentDate: date,
        userId,
        reason: dto.reason,
        operationKind: dto.status,
        payload: { depreciationPolicy: dto.depreciationPolicy ?? null, endDate: dto.endDate ?? null },
        lines: [{ assetId, statusBefore: from, statusAfter: dto.status }],
      });
      await this.ledger.write(tx, { tenantId, organizationId, assetId, movementType: MovementType.STATUS_CHANGE, businessDate: date, sourceDocumentType: FaDocumentType.STATUS_CHANGE, sourceDocumentId: doc.id, description: `${from} -> ${dto.status}`, createdBy: userId });
      await tx.fixedAsset.update({ where: { id: assetId }, data: { status: dto.status, updatedBy: userId, version: { increment: 1 } } });
      await this.history.recordParameter(tx, { tenantId, assetId, parameterCode: 'status', oldValue: from, newValue: dto.status, effectiveDate: date, sourceDocumentType: FaDocumentType.STATUS_CHANGE, sourceDocumentId: doc.id, reason: dto.reason, createdBy: userId });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_STATUS_CHANGED', entityType: 'FixedAsset', entityId: assetId, action: 'STATUS', userId, oldValues: { status: from }, newValues: { status: dto.status, depreciationPolicy: dto.depreciationPolicy }, reason: dto.reason }, tx);
      return doc;
    });
  }
}
