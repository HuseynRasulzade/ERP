import { Injectable, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import {
  AssetStatus,
  Books,
  CandidateDecision,
  CandidateStatus,
  FaDocumentType,
  IN_USE_STATUSES,
  MovementType,
  dec,
  formatAmount,
  nextPeriod,
  periodOf,
  toDate,
} from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { FixedAssetAcquisitionService } from './fixed-asset-acquisition.service';
import { CapitalInvestmentService, allocateProportionally } from './capital-investment.service';
import { CipBalanceExceededError, FixedAssetCostIncompleteError, FixedAssetInvalidStateError } from './fixed-asset.errors';

export interface ModernizeDto {
  date: string;
  kind?: string; // MODERNIZATION | RECONSTRUCTION | CAPITAL_REPAIR | UPGRADE | USEFUL_LIFE_EXTENSION | SIGNIFICANT_REPLACEMENT
  candidateIds?: string[];
  cipProjectId?: string;
  cipAmount?: number;
  usefulLifeMonths?: number;
  remainingUsefulLifeMonths?: number;
  residualValue?: number;
  description?: string;
}

/**
 * FixedAssetModernizationService (spec sections 45-50, 103-104, 151-152):
 * subsequent capital expenditure raises the gross carrying amount via a
 * MODERNIZATION movement (original cost history is never overwritten) and
 * may prospectively change life / residual. Ordinary repairs are recorded
 * for the maintenance history only and are never capitalized automatically.
 */
@Injectable()
export class FixedAssetModernizationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly documents: FixedAssetDocumentService,
    private readonly history: FixedAssetHistoryService,
    private readonly policies: DepreciationPolicyService,
    private readonly acquisition: FixedAssetAcquisitionService,
    private readonly cip: CapitalInvestmentService,
  ) {}

  onModuleInit() {
    this.documents.registerReversalHook(FaDocumentType.MODERNIZATION, async (tx, doc, userId) => {
      const comps = await tx.fixedAssetCostComponent.findMany({ where: { tenantId: doc.tenantId, modernizationDocumentId: doc.id, released: false } });
      for (const comp of comps) {
        if (comp.cipCostId) {
          await tx.fixedAssetCostComponent.update({ where: { id: comp.id }, data: { released: true } });
        } else {
          await tx.fixedAssetCostComponent.update({ where: { id: comp.id }, data: { recognized: false, modernizationDocumentId: null } });
          if (comp.candidateId) await tx.fixedAssetAcquisitionCandidate.update({ where: { id: comp.candidateId }, data: { status: CandidateStatus.ASSIGNED_TO_ASSET } });
        }
      }
      const cipRows = await tx.capitalInvestmentCost.findMany({ where: { tenantId: doc.tenantId, sourceDocumentType: FaDocumentType.MODERNIZATION, sourceDocumentId: doc.id, reversalOfId: null } });
      for (const r of cipRows) {
        await tx.capitalInvestmentCost.create({
          data: { tenantId: r.tenantId, organizationId: r.organizationId, cipProjectId: r.cipProjectId, costComponent: r.costComponent, movementKind: 'REVERSAL', businessDate: r.businessDate, amount: dec(r.amount).negated().toString(), baseAmount: dec(r.baseAmount).negated().toString(), sourceDocumentType: r.sourceDocumentType, sourceDocumentId: r.sourceDocumentId, assetId: r.assetId, reversalOfId: r.id, description: 'Modernization reversed', createdBy: userId },
        });
      }
    });
  }

  /** Puts the asset UNDER_MODERNIZATION (spec section 46) — unless the
   * parallel-improvement policy keeps it ACTIVE. */
  async start(tenantId: string, membershipId: string, organizationId: string, assetId: string, userId: string, dto: { date: string; reason?: string; keepActive?: boolean }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.STATUS_CHANGE);
    const date = toDate(dto.date);
    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (asset.status !== AssetStatus.ACTIVE && asset.status !== AssetStatus.IMPAIRED) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; modernization can only start on an active asset.`);
      if (dto.keepActive) return { assetId, status: asset.status, parallelImprovement: true };
      const doc = await this.documents.create(tx, {
        tenantId, organizationId, documentType: FaDocumentType.STATUS_CHANGE, documentDate: date, userId, reason: dto.reason ?? 'Modernization started', operationKind: AssetStatus.UNDER_MODERNIZATION,
        lines: [{ assetId, statusBefore: asset.status, statusAfter: AssetStatus.UNDER_MODERNIZATION }],
      });
      await this.ledger.write(tx, { tenantId, organizationId, assetId, movementType: MovementType.STATUS_CHANGE, businessDate: date, sourceDocumentType: FaDocumentType.STATUS_CHANGE, sourceDocumentId: doc.id, description: 'Modernization started', createdBy: userId });
      await tx.fixedAsset.update({ where: { id: assetId }, data: { status: AssetStatus.UNDER_MODERNIZATION, version: { increment: 1 } } });
      await this.history.recordParameter(tx, { tenantId, assetId, parameterCode: 'status', oldValue: asset.status, newValue: AssetStatus.UNDER_MODERNIZATION, effectiveDate: date, sourceDocumentType: FaDocumentType.STATUS_CHANGE, sourceDocumentId: doc.id, createdBy: userId });
      return doc;
    });
  }

  /** Completes / capitalizes a modernization (spec section 47). */
  async modernize(tenantId: string, membershipId: string, organizationId: string, assetId: string, userId: string, dto: ModernizeDto) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.MODERNIZATION);
    await this.acquisition.prepare(tenantId);
    const date = toDate(dto.date);

    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (!IN_USE_STATUSES.includes(asset.status) || asset.status === AssetStatus.HELD_FOR_SALE) {
        throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; it cannot be modernized.`);
      }

      // Candidates explicitly listed and still CAPITALIZABLE are assigned now.
      for (const cid of dto.candidateIds ?? []) {
        const c = await tx.fixedAssetAcquisitionCandidate.findFirst({ where: { id: cid, tenantId, organizationId } });
        if (!c) throw new NotFoundAppError('FixedAssetAcquisitionCandidate', cid);
        if (c.status === CandidateStatus.ASSIGNED_TO_ASSET && c.assignedAssetId === assetId) continue;
        await this.acquisition.classifyInTx(tx, tenantId, organizationId, cid, userId, { decision: CandidateDecision.ASSIGN_TO_ASSET, assetId, reason: 'Modernization cost' });
      }
      const pending = await tx.fixedAssetCostComponent.findMany({
        where: { tenantId, assetId, purpose: 'MODERNIZATION', recognized: false, released: false, ...(dto.candidateIds?.length ? { candidateId: { in: dto.candidateIds } } : {}) },
      });
      let total = pending.reduce((s, c) => s.plus(dec(c.amount)), new Decimal(0));

      const cipComponents: { component: string; amount: Decimal; costId: string }[] = [];
      if (dto.cipProjectId) {
        await tx.$queryRaw`SELECT id FROM capital_investment_projects WHERE id = ${dto.cipProjectId} AND tenant_id = ${tenantId} FOR UPDATE`;
        const project = await tx.capitalInvestmentProject.findFirst({ where: { id: dto.cipProjectId, tenantId, organizationId } });
        if (!project) throw new NotFoundAppError('CapitalInvestmentProject', dto.cipProjectId);
        if (project.targetAssetId && project.targetAssetId !== assetId) throw new ValidationAppError(`CIP project ${project.code} targets another asset`);
        const byComponent = await this.cip.balanceByComponent(tenantId, project.id, tx);
        const remaining = [...byComponent.values()].reduce((s, v) => s.plus(v), new Decimal(0));
        const amount = dto.cipAmount !== undefined ? dec(dto.cipAmount) : remaining;
        if (amount.gt(remaining)) throw new CipBalanceExceededError(formatAmount(amount), formatAmount(remaining));
        for (const [component, part] of allocateProportionally(amount, byComponent)) {
          if (part.isZero()) continue;
          cipComponents.push({ component, amount: part, costId: '' });
        }
        total = total.plus(amount);
      }
      if (total.lte(0)) throw new FixedAssetCostIncompleteError(asset.assetNumber, 'modernized');

      const before = await this.ledger.balances(tenantId, assetId, { tx });
      const current = await this.policies.latestBookPolicy(tenantId, assetId, Books.ACCOUNTING_BOOK, tx);
      const lastPosted = await tx.fixedAssetDepreciationLine.findFirst({ where: { tenantId, assetId, bookCode: Books.ACCOUNTING_BOOK, status: 'POSTED' }, orderBy: { period: 'desc' } });
      let effectivePeriod = periodOf(date);
      if (lastPosted && lastPosted.period >= effectivePeriod) effectivePeriod = nextPeriod(lastPosted.period);
      if (current && current.effectivePeriod > effectivePeriod) effectivePeriod = current.effectivePeriod;
      const remainingBefore = current ? await this.policies.remainingLifeAt(tenantId, assetId, Books.ACCOUNTING_BOOK, current, effectivePeriod, tx) : null;
      const elapsed = current && remainingBefore !== null ? (current.usefulLifeMonths ?? remainingBefore) - remainingBefore : 0;
      let remainingAfter = remainingBefore;
      if (dto.remainingUsefulLifeMonths !== undefined) remainingAfter = dto.remainingUsefulLifeMonths;
      else if (dto.usefulLifeMonths !== undefined) remainingAfter = dto.usefulLifeMonths - elapsed;
      if (remainingAfter !== null && remainingAfter <= 0) throw new ValidationAppError('The new useful life leaves no remaining life');
      const lifeChanged = current && (remainingAfter !== remainingBefore || (dto.residualValue !== undefined && !dec(dto.residualValue).eq(dec(current.residualValue))));

      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.MODERNIZATION,
        documentDate: date,
        userId,
        operationKind: dto.kind ?? 'MODERNIZATION',
        description: dto.description ?? `${dto.kind ?? 'Modernization'} of ${asset.assetNumber}`,
        cipProjectId: dto.cipProjectId,
        lines: [
          {
            assetId,
            amount: total.toString(),
            costBefore: before.cost.toString(),
            accumulatedDepreciationBefore: before.accumulatedDepreciation.toString(),
            impairmentBefore: before.impairment.toString(),
            carryingAmountBefore: before.netBookValue.toString(),
            carryingAmountAfter: before.netBookValue.plus(total).toString(),
            usefulLifeBefore: current?.usefulLifeMonths ?? null,
            usefulLifeAfter: remainingAfter !== null ? elapsed + remainingAfter : null,
            remainingLifeBefore: remainingBefore,
            remainingLifeAfter: remainingAfter,
            residualBefore: current ? current.residualValue.toString() : null,
            residualAfter: dto.residualValue !== undefined ? String(dto.residualValue) : current ? current.residualValue.toString() : null,
            statusBefore: asset.status,
            statusAfter: asset.status === AssetStatus.UNDER_MODERNIZATION ? AssetStatus.ACTIVE : asset.status,
            details: { sources: pending.map((p) => ({ candidateId: p.candidateId, amount: p.amount.toString(), costComponent: p.costComponent, sourceDocumentType: p.sourceDocumentType, sourceDocumentId: p.sourceDocumentId })), cip: cipComponents.map((c) => ({ component: c.component, amount: c.amount.toString() })) },
          },
        ],
      });

      for (const cc of cipComponents) {
        const reg = await tx.capitalInvestmentCost.create({
          data: { tenantId, organizationId, cipProjectId: dto.cipProjectId!, costComponent: cc.component, movementKind: 'CAPITALIZATION', businessDate: date, amount: cc.amount.negated().toString(), baseAmount: cc.amount.negated().toString(), sourceDocumentType: FaDocumentType.MODERNIZATION, sourceDocumentId: doc.id, assetId, description: `Modernization ${doc.number}`, createdBy: userId },
        });
        await tx.fixedAssetCostComponent.create({
          data: { tenantId, assetId, costComponent: cc.component, amount: cc.amount.toString(), cipProjectId: dto.cipProjectId, cipCostId: reg.id, sourceDocumentType: FaDocumentType.MODERNIZATION, sourceDocumentId: doc.id, purpose: 'MODERNIZATION', modernizationDocumentId: doc.id, recognized: true, createdBy: userId },
        });
      }
      if (pending.length) {
        await tx.fixedAssetCostComponent.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { recognized: true, modernizationDocumentId: doc.id } });
        const cids = pending.map((p) => p.candidateId).filter((x): x is string => !!x);
        if (cids.length) await tx.fixedAssetAcquisitionCandidate.updateMany({ where: { id: { in: cids } }, data: { status: CandidateStatus.CAPITALIZED, version: { increment: 1 } } });
      }

      const profile = asset.category.accountingMappingProfile;
      const faCost = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_COST, date, profile, tx);
      const cipAcc = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_CIP, date, profile, tx);
      const je = await this.accounting.post(
        tenantId,
        userId,
        {
          organizationId,
          businessDate: date,
          description: `Modernization ${doc.number} — ${asset.assetNumber}`,
          sourceDocumentType: FaDocumentType.MODERNIZATION,
          sourceDocumentId: doc.id,
          lines: [this.accounting.line(faCost.id, 'DEBIT', total, `Capitalized improvement ${asset.assetNumber}`, { assetId }), this.accounting.line(cipAcc.id, 'CREDIT', total, `CIP ${asset.assetNumber}`, { assetId })],
        },
        tx,
      );
      await this.documents.attachJournal(tx, doc.id, je?.id);
      await this.ledger.write(tx, {
        tenantId,
        organizationId,
        assetId,
        movementType: MovementType.MODERNIZATION,
        businessDate: date,
        costIncrease: total,
        departmentId: asset.departmentId,
        locationId: asset.locationId,
        sourceDocumentType: FaDocumentType.MODERNIZATION,
        sourceDocumentId: doc.id,
        sourceDocumentLineId: doc.lines[0].id,
        journalEntryId: je?.id,
        description: dto.kind ?? 'MODERNIZATION',
        createdBy: userId,
      });

      if (current && lifeChanged) {
        await this.policies.createBookPolicy(tx, {
          tenantId,
          assetId,
          effectiveDate: date,
          effectivePeriod,
          usefulLifeMonths: remainingAfter !== null ? elapsed + remainingAfter : current.usefulLifeMonths,
          remainingLifeMonths: remainingAfter,
          residualValue: dto.residualValue !== undefined ? dto.residualValue : current.residualValue,
          depreciationMethod: current.depreciationMethod,
          depreciationRate: current.depreciationRate,
          depreciationStartRule: current.depreciationStartRule,
          partialPeriodRule: current.partialPeriodRule,
          changeReason: `Modernization ${doc.number}`,
          sourceDocumentType: FaDocumentType.MODERNIZATION,
          sourceDocumentId: doc.id,
          createdBy: userId,
        });
        await this.policies.reprojectParameters(tx, tenantId, assetId);
      }
      if (asset.status === AssetStatus.UNDER_MODERNIZATION) {
        await tx.fixedAsset.update({ where: { id: assetId }, data: { status: AssetStatus.ACTIVE } });
        await this.history.recordParameter(tx, { tenantId, assetId, parameterCode: 'status', oldValue: asset.status, newValue: AssetStatus.ACTIVE, effectiveDate: date, sourceDocumentType: FaDocumentType.MODERNIZATION, sourceDocumentId: doc.id, createdBy: userId });
      }
      const after = await this.ledger.refreshProjection(tx, tenantId, assetId);
      await this.audit.record(
        { tenantId, eventType: 'FixedAssetModernized', entityType: 'FixedAsset', entityId: assetId, action: 'MODERNIZE', userId, oldValues: { cost: before.cost.toString(), nbv: before.netBookValue.toString(), remainingLife: remainingBefore }, newValues: { cost: after.cost.toString(), nbv: after.netBookValue.toString(), remainingLife: remainingAfter, documentId: doc.id, journalEntryId: je?.id } },
        tx,
      );
      return { ...doc, journalEntryId: je?.id ?? null };
    });
  }

  /**
   * Repair record (spec sections 48-50, 103): EXPENSE_REPAIR keeps the
   * asset cost unchanged (the linked candidate, if any, is expensed:
   * Dr FA_REPAIR_EXPENSE, Cr FA_CIP); CAPITAL_IMPROVEMENT routes the cost into
   * the modernization flow as a pending component. Never automatic.
   */
  async repair(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    assetId: string,
    userId: string,
    dto: { date: string; description: string; amount?: number; decision: 'EXPENSE_REPAIR' | 'CAPITAL_IMPROVEMENT'; candidateId?: string; sourceDocumentType?: string; sourceDocumentId?: string; reason?: string; expenseAccountId?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    if (!['EXPENSE_REPAIR', 'CAPITAL_IMPROVEMENT'].includes(dto.decision)) throw new ValidationAppError('decision must be EXPENSE_REPAIR or CAPITAL_IMPROVEMENT');
    await this.documents.prepare(tenantId, FaDocumentType.REPAIR);
    await this.acquisition.prepare(tenantId);
    const date = toDate(dto.date);
    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      let amount = dto.amount !== undefined ? dec(dto.amount) : new Decimal(0);
      let candidateJe: string | null = null;
      if (dto.candidateId) {
        const c = await tx.fixedAssetAcquisitionCandidate.findFirst({ where: { id: dto.candidateId, tenantId, organizationId } });
        if (!c) throw new NotFoundAppError('FixedAssetAcquisitionCandidate', dto.candidateId);
        amount = dec(c.capitalizableAmount);
        const updated = await this.acquisition.classifyInTx(tx, tenantId, organizationId, c.id, userId, {
          decision: dto.decision === 'EXPENSE_REPAIR' ? CandidateDecision.EXPENSE : CandidateDecision.ASSIGN_TO_ASSET,
          costComponent: dto.decision === 'EXPENSE_REPAIR' ? 'REPAIR' : c.costComponent,
          assetId,
          expenseAccountId: dto.expenseAccountId,
          reason: dto.reason ?? dto.description,
        });
        candidateJe = updated.expenseJournalEntryId;
      }
      const before = await this.ledger.balances(tenantId, assetId, { tx });
      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.REPAIR,
        documentDate: date,
        userId,
        operationKind: dto.decision,
        description: dto.description,
        reason: dto.reason,
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        payload: { candidateId: dto.candidateId ?? null, expenseJournalEntryId: candidateJe },
        lines: [{ assetId, amount: amount.toString(), costBefore: before.cost.toString(), carryingAmountBefore: before.netBookValue.toString(), carryingAmountAfter: before.netBookValue.toString() }],
      });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_REPAIR_RECORDED', entityType: 'FixedAsset', entityId: assetId, action: 'REPAIR', userId, newValues: { decision: dto.decision, amount: amount.toString(), documentId: doc.id, candidateId: dto.candidateId } }, tx);
      return doc;
    });
  }
}
