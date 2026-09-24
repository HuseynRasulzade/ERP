import { Injectable, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import {
  AssetStatus,
  Books,
  CLOSED_STATUSES,
  DisposalType,
  FaDocumentType,
  MovementType,
  PartialDisposalMethod,
  RECOGNIZED_STATUSES,
  WRITE_OFF_DISPOSAL_TYPES,
  dec,
  formatPeriodLabel,
  periodBounds,
  periodOf,
  previousPeriod,
  toDate,
} from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { DepreciationNotFinalizedError, FixedAssetInvalidStateError, FixedAssetPolicyViolationError } from './fixed-asset.errors';

export interface DisposeDto {
  date: string;
  disposalType: string;
  share?: number;
  quantity?: number;
  partialMethod?: string;
  proceeds?: number;
  disposalCosts?: number;
  buyerCounterpartyId?: string;
  salesInvoiceId?: string;
  reason: string;
  scrapValue?: number;
  scrapSourceDocumentType?: string;
  scrapSourceDocumentId?: string;
  approvalReference?: string;
}

/**
 * FixedAssetDisposalService (spec sections 65-74, 112, 157-158): sale,
 * write-off, scrap, donation, loss, theft, transfer-out, partial disposal
 * and component replacement. Gross carrying amount, accumulated
 * depreciation and impairment are all derecognized from the register; the
 * gain/loss is computed as proceeds - NBV (disposal costs are reported but
 * recognized by their own source documents, never netted silently).
 */
@Injectable()
export class FixedAssetDisposalService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly documents: FixedAssetDocumentService,
    private readonly history: FixedAssetHistoryService,
    private readonly policies: DepreciationPolicyService,
  ) {}

  onModuleInit() {
    this.documents.registerReversalHook(FaDocumentType.DISPOSAL, async (tx, doc) => {
      for (const line of doc.lines) {
        const before = (line.details as any)?.quantityBefore;
        await tx.fixedAsset.update({ where: { id: line.assetId }, data: { disposalDate: null, ...(before !== undefined ? { quantity: String(before) } : {}) } });
      }
    });
  }

  private computeShare(asset: { quantity: any; assetNumber: string }, dto: DisposeDto) {
    const qty = dec(asset.quantity);
    if (dto.quantity !== undefined) {
      const q = dec(dto.quantity);
      if (q.lte(0) || q.gt(qty)) throw new ValidationAppError(`Disposal quantity must be between 0 and ${qty.toString()}`);
      return { share: q.div(qty), quantity: q };
    }
    const share = dto.share !== undefined ? dec(dto.share) : new Decimal(1);
    if (share.lte(0) || share.gt(1)) throw new ValidationAppError('Disposal share must be in (0, 1]');
    return { share, quantity: qty.mul(share) };
  }

  async preview(tenantId: string, membershipId: string, organizationId: string, assetId: string, dto: DisposeDto) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: assetId, tenantId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', assetId);
    const b = await this.ledger.balances(tenantId, assetId);
    const { share } = this.computeShare(asset, dto);
    return this.calculate(b, share, dto);
  }

  private calculate(b: Awaited<ReturnType<FixedAssetLedgerService['balances']>>, share: Decimal, dto: DisposeDto) {
    const full = share.eq(1);
    const part = (v: Decimal) => (full ? v : v.mul(share).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    const cost = part(b.cost);
    const revaluation = part(b.revaluation);
    const accumulatedDepreciation = part(b.accumulatedDepreciation);
    const impairment = part(b.impairment);
    const nbv = cost.plus(revaluation).minus(accumulatedDepreciation).minus(impairment);
    const proceeds = dec(dto.proceeds);
    const disposalCosts = dec(dto.disposalCosts);
    const gainLoss = proceeds.minus(nbv);
    return {
      share: share.toString(),
      grossCost: cost.toString(),
      revaluation: revaluation.toString(),
      accumulatedDepreciation: accumulatedDepreciation.toString(),
      impairment: impairment.toString(),
      netBookValue: nbv.toString(),
      proceeds: proceeds.toString(),
      disposalCosts: disposalCosts.toString(),
      gainLoss: gainLoss.toString(),
      gainLossAfterCosts: gainLoss.minus(disposalCosts).toString(),
      _d: { cost, revaluation, accumulatedDepreciation, impairment, nbv, proceeds, disposalCosts, gainLoss },
    };
  }

  async dispose(tenantId: string, membershipId: string, organizationId: string, assetId: string, userId: string, dto: DisposeDto) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    if (!Object.values(DisposalType).includes(dto.disposalType as any)) throw new ValidationAppError(`Unknown disposal type ${dto.disposalType}`);
    await this.documents.prepare(tenantId, FaDocumentType.DISPOSAL);
    return this.prisma.runInTransaction((tx) => this.disposeInTx(tx, tenantId, organizationId, assetId, userId, dto));
  }

  async disposeInTx(tx: PrismaTransactionClient, tenantId: string, organizationId: string, assetId: string, userId: string, dto: DisposeDto) {
    const date = toDate(dto.date);
    const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
    if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
    if (CLOSED_STATUSES.includes(asset.status)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is already ${asset.status}.`);
    if (!RECOGNIZED_STATUSES.includes(asset.status)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; only a recognized asset can be disposed.`);
    if (asset.status === AssetStatus.UNDER_MODERNIZATION) {
      throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is under modernization; complete or cancel the modernization before disposing it.`);
    }
    const pendingModernization = await tx.fixedAssetCostComponent.count({ where: { tenantId, assetId, purpose: 'MODERNIZATION', recognized: false, released: false } });
    if (pendingModernization > 0) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} has ${pendingModernization} uncapitalized modernization cost(s); resolve them before disposal.`);
    if (dto.partialMethod === PartialDisposalMethod.SPECIFIC_COMPONENT) {
      throw new ValidationAppError('SPECIFIC_COMPONENT partial disposal is done by disposing the component asset itself (type COMPONENT_REPLACEMENT)');
    }
    if (dto.disposalType === DisposalType.SALE && dto.proceeds === undefined) throw new ValidationAppError('A sale needs the sale proceeds');
    if (dto.scrapValue && dto.scrapValue > 0 && !dto.scrapSourceDocumentId) {
      throw new FixedAssetPolicyViolationError('A scrap value can only be recorded with its source document (e.g. the inventory receipt of the scrap); it is never netted silently.');
    }
    if (dto.salesInvoiceId) {
      const inv = await tx.salesInvoice.findFirst({ where: { id: dto.salesInvoiceId, tenantId } });
      if (!inv) throw new NotFoundAppError('SalesInvoice', dto.salesInvoiceId);
    }
    if (dto.buyerCounterpartyId) {
      const cp = await tx.counterparty.findFirst({ where: { id: dto.buyerCounterpartyId, tenantId } });
      if (!cp) throw new NotFoundAppError('Counterparty', dto.buyerCounterpartyId);
    }

    const { share, quantity } = this.computeShare(asset, dto);
    const full = share.eq(1);
    if (full) {
      const activeChildren = await tx.fixedAsset.count({ where: { tenantId, parentAssetId: assetId, status: { notIn: [...CLOSED_STATUSES, 'CANCELLED'] } } });
      if (activeChildren > 0) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} still has ${activeChildren} active component(s); dispose them first.`);
    }

    // Prior-period depreciation must be finalized (spec section 145 example).
    const policy = await this.policies.resolvePolicy(tenantId, organizationId, asset.categoryId, date, Books.ACCOUNTING_BOOK, tx);
    if (policy.requirePriorPeriodDepreciationForDisposal && asset.depreciationStartDate && [AssetStatus.ACTIVE, AssetStatus.IMPAIRED, AssetStatus.PARTIALLY_DISPOSED].includes(asset.status as any)) {
      const prev = previousPeriod(periodOf(date));
      const prevEnd = periodBounds(prev).end;
      if (asset.depreciationStartDate.getTime() <= prevEnd.getTime()) {
        const b0 = await this.ledger.balances(tenantId, assetId, { tx });
        const bp = await this.policies.latestBookPolicy(tenantId, assetId, Books.ACCOUNTING_BOOK, tx);
        const residual = bp ? dec(bp.residualValue) : new Decimal(0);
        const fullyDepreciated = b0.netBookValue.lte(residual);
        const done = await tx.fixedAssetDepreciationLine.findFirst({ where: { tenantId, assetId, bookCode: Books.ACCOUNTING_BOOK, period: prev, status: 'POSTED' } });
        if (!done && !fullyDepreciated) {
          throw new DepreciationNotFinalizedError(`Asset ${asset.assetNumber} cannot be disposed because depreciation for the previous period (${formatPeriodLabel(prev)}) is not finalized.`);
        }
      }
    }

    const b = await this.ledger.balances(tenantId, assetId, { tx });
    const calc = this.calculate(b, share, dto);
    const d = calc._d;
    const movementType = !full ? MovementType.PARTIAL_DISPOSAL : WRITE_OFF_DISPOSAL_TYPES.includes(dto.disposalType) ? MovementType.WRITE_OFF : MovementType.FULL_DISPOSAL;
    const newStatus = !full ? AssetStatus.PARTIALLY_DISPOSED : WRITE_OFF_DISPOSAL_TYPES.includes(dto.disposalType) ? AssetStatus.WRITTEN_OFF : AssetStatus.DISPOSED;

    const doc = await this.documents.create(tx, {
      tenantId,
      organizationId,
      documentType: FaDocumentType.DISPOSAL,
      documentDate: date,
      userId,
      reason: dto.reason,
      operationKind: dto.disposalType,
      approvalReference: dto.approvalReference,
      counterpartyId: dto.buyerCounterpartyId,
      sourceDocumentType: dto.salesInvoiceId ? 'SALES_INVOICE' : undefined,
      sourceDocumentId: dto.salesInvoiceId,
      description: `${dto.disposalType} of ${asset.assetNumber}${full ? '' : ` (share ${share.toFixed(4)})`}`,
      payload: { partialMethod: dto.partialMethod ?? (full ? null : PartialDisposalMethod.PROPORTIONAL_COST), scrapValue: dto.scrapValue ?? null, scrapSourceDocumentType: dto.scrapSourceDocumentType ?? null, scrapSourceDocumentId: dto.scrapSourceDocumentId ?? null, gainLossAfterCosts: calc.gainLossAfterCosts },
      lines: [
        {
          assetId,
          costBefore: b.cost.toString(),
          accumulatedDepreciationBefore: b.accumulatedDepreciation.toString(),
          impairmentBefore: b.impairment.toString(),
          revaluationBefore: b.revaluation.toString(),
          carryingAmountBefore: b.netBookValue.toString(),
          carryingAmountAfter: b.netBookValue.minus(d.nbv).toString(),
          amount: d.cost.toString(),
          proceeds: d.proceeds.toString(),
          disposalCosts: d.disposalCosts.toString(),
          gainLoss: d.gainLoss.toString(),
          share: share.toString(),
          quantity: quantity.toString(),
          statusBefore: asset.status,
          statusAfter: newStatus,
          details: { quantityBefore: asset.quantity.toString(), derecognized: { cost: calc.grossCost, revaluation: calc.revaluation, accumulatedDepreciation: calc.accumulatedDepreciation, impairment: calc.impairment, netBookValue: calc.netBookValue } },
        },
      ],
    });

    const profile = asset.category.accountingMappingProfile;
    const r = (key: string) => this.accounting.resolve(tenantId, organizationId, key, date, profile, tx);
    const lines: AccountingPostingLineInput[] = [];
    const dims = { assetId };
    lines.push(this.accounting.line((await r(MappingKeys.FA_ACCUMULATED_DEPRECIATION)).id, 'DEBIT', d.accumulatedDepreciation, `Derecognize accumulated depreciation ${asset.assetNumber}`, dims));
    lines.push(this.accounting.line((await r(MappingKeys.FA_ACCUMULATED_IMPAIRMENT)).id, 'DEBIT', d.impairment, `Derecognize impairment ${asset.assetNumber}`, dims));
    if (d.proceeds.gt(0)) lines.push(this.accounting.line((await r(MappingKeys.FA_DISPOSAL_PROCEEDS)).id, 'DEBIT', d.proceeds, `Disposal proceeds ${asset.assetNumber}`));
    const gross = d.cost.plus(d.revaluation);
    if (gross.gt(0)) lines.push(this.accounting.line((await r(MappingKeys.FA_COST)).id, 'CREDIT', gross, `Derecognize gross cost ${asset.assetNumber}`, dims));
    else if (gross.lt(0)) lines.push(this.accounting.line((await r(MappingKeys.FA_COST)).id, 'DEBIT', gross.negated(), `Derecognize gross cost ${asset.assetNumber}`, dims));
    if (d.gainLoss.gt(0)) lines.push(this.accounting.line((await r(MappingKeys.FA_DISPOSAL_GAIN)).id, 'CREDIT', d.gainLoss, `Gain on disposal ${asset.assetNumber}`));
    if (d.gainLoss.lt(0)) lines.push(this.accounting.line((await r(MappingKeys.FA_DISPOSAL_LOSS)).id, 'DEBIT', d.gainLoss.negated(), `Loss on disposal ${asset.assetNumber}`, { departmentId: asset.departmentId }));
    const je = await this.accounting.post(tenantId, userId, { organizationId, businessDate: date, description: `Disposal ${doc.number} — ${asset.assetNumber} (${dto.disposalType})`, sourceDocumentType: FaDocumentType.DISPOSAL, sourceDocumentId: doc.id, lines }, tx);
    await this.documents.attachJournal(tx, doc.id, je?.id);

    await this.ledger.write(tx, {
      tenantId,
      organizationId,
      assetId,
      movementType,
      businessDate: date,
      costDecrease: d.cost,
      revaluationDecrease: d.revaluation.gt(0) ? d.revaluation : 0,
      revaluationIncrease: d.revaluation.lt(0) ? d.revaluation.negated() : 0,
      depreciationDecrease: d.accumulatedDepreciation,
      impairmentDecrease: d.impairment,
      quantityChange: quantity.negated(),
      departmentId: asset.departmentId,
      locationId: asset.locationId,
      sourceDocumentType: FaDocumentType.DISPOSAL,
      sourceDocumentId: doc.id,
      sourceDocumentLineId: doc.lines[0].id,
      journalEntryId: je?.id,
      description: dto.reason,
      createdBy: userId,
    });
    // Tax-book (and any other book) accumulated depreciation is derecognized too.
    const otherBooks = await tx.fixedAssetMovement.findMany({ where: { tenantId, assetId, bookCode: { not: Books.ACCOUNTING_BOOK } }, distinct: ['bookCode'], select: { bookCode: true } });
    for (const { bookCode } of otherBooks) {
      const ob = await this.ledger.balances(tenantId, assetId, { tx, book: bookCode });
      const dep = full ? ob.accumulatedDepreciation : ob.accumulatedDepreciation.mul(share).toDecimalPlaces(2);
      const imp = full ? ob.impairment : ob.impairment.mul(share).toDecimalPlaces(2);
      if (dep.isZero() && imp.isZero()) continue;
      await this.ledger.write(tx, { tenantId, organizationId, assetId, bookCode, movementType, businessDate: date, depreciationDecrease: dep, impairmentDecrease: imp, sourceDocumentType: FaDocumentType.DISPOSAL, sourceDocumentId: doc.id, description: `${bookCode} derecognition`, createdBy: userId });
    }

    await tx.fixedAsset.update({
      where: { id: assetId },
      data: { status: newStatus, quantity: dec(asset.quantity).minus(quantity).toString(), ...(full ? { disposalDate: date } : {}), updatedBy: userId },
    });
    await this.history.recordParameter(tx, { tenantId, assetId, parameterCode: 'status', oldValue: asset.status, newValue: newStatus, effectiveDate: date, sourceDocumentType: FaDocumentType.DISPOSAL, sourceDocumentId: doc.id, reason: dto.reason, createdBy: userId });
    await this.ledger.refreshProjection(tx, tenantId, assetId);
    await this.audit.record(
      {
        tenantId,
        eventType: newStatus === AssetStatus.WRITTEN_OFF ? 'FixedAssetWrittenOff' : 'FixedAssetDisposed',
        entityType: 'FixedAsset',
        entityId: assetId,
        action: 'DISPOSE',
        userId,
        oldValues: { status: asset.status, netBookValue: b.netBookValue.toString() },
        newValues: { status: newStatus, disposalType: dto.disposalType, share: share.toString(), proceeds: calc.proceeds, gainLoss: calc.gainLoss, documentId: doc.id, journalEntryId: je?.id, salesInvoiceId: dto.salesInvoiceId },
        reason: dto.reason,
      },
      tx,
    );
    const { _d, ...publicCalc } = calc;
    return { ...doc, journalEntryId: je?.id ?? null, calculation: publicCalc };
  }
}
