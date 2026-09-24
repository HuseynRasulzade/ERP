import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { FaDocumentType, MovementType, RECOGNIZED_STATUSES, dec, toDate } from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetInvalidStateError, FixedAssetPolicyViolationError } from './fixed-asset.errors';

/**
 * FixedAssetRevaluationService (spec sections 57-58) — foundation of the
 * REVALUATION_MODEL: allowed only for categories on that model. The delta
 * between fair value and carrying amount is carried as a separate
 * revaluation measure (never folded into original cost):
 *   increase: Dr FA_COST  Cr FA_REVALUATION_RESERVE
 *   decrease: Dr FA_REVALUATION_RESERVE (up to the asset's reserve)
 *             Dr FA_REVALUATION_LOSS (remainder)   Cr FA_COST
 * Full localization-specific treatment (e.g. proportional restatement of
 * accumulated depreciation, reserve transfer to retained earnings on
 * disposal) is left to the localization layer.
 */
@Injectable()
export class FixedAssetRevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly documents: FixedAssetDocumentService,
  ) {}

  async revalue(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    assetId: string,
    userId: string,
    dto: { date: string; fairValue: number; reason: string; valuationSource?: string; approvalReference?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.REVALUATION);
    const date = toDate(dto.date);
    const fair = dec(dto.fairValue);
    if (fair.lt(0)) throw new FixedAssetPolicyViolationError('Fair value cannot be negative');

    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (asset.category.revaluationModel !== 'REVALUATION_MODEL') {
        throw new FixedAssetPolicyViolationError(`Category ${asset.category.code} uses the ${asset.category.revaluationModel}; revaluation requires the REVALUATION_MODEL.`);
      }
      if (!RECOGNIZED_STATUSES.includes(asset.status)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; it cannot be revalued.`);
      const b = await this.ledger.balances(tenantId, assetId, { tx });
      const delta = fair.minus(b.netBookValue);
      if (delta.isZero()) throw new FixedAssetPolicyViolationError('Fair value equals the carrying amount; nothing to revalue.');

      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.REVALUATION,
        documentDate: date,
        userId,
        reason: dto.reason,
        valuationSource: dto.valuationSource,
        approvalReference: dto.approvalReference,
        operationKind: delta.gt(0) ? 'INCREASE' : 'DECREASE',
        description: `Revaluation of ${asset.assetNumber}`,
        lines: [{ assetId, costBefore: b.cost.toString(), revaluationBefore: b.revaluation.toString(), carryingAmountBefore: b.netBookValue.toString(), fairValue: fair.toString(), amount: delta.toString(), carryingAmountAfter: fair.toString() }],
      });
      const profile = asset.category.accountingMappingProfile;
      const faCost = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_COST, date, profile, tx);
      const reserve = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_REVALUATION_RESERVE, date, profile, tx);
      const lines: AccountingPostingLineInput[] = [];
      if (delta.gt(0)) {
        lines.push(this.accounting.line(faCost.id, 'DEBIT', delta, `Revaluation increase ${asset.assetNumber}`, { assetId }));
        lines.push(this.accounting.line(reserve.id, 'CREDIT', delta, `Revaluation reserve ${asset.assetNumber}`));
      } else {
        const decrease = delta.negated();
        const fromReserve = Decimal.min(decrease, Decimal.max(b.revaluation, 0));
        const toLoss = decrease.minus(fromReserve);
        if (fromReserve.gt(0)) lines.push(this.accounting.line(reserve.id, 'DEBIT', fromReserve, `Revaluation reserve release ${asset.assetNumber}`));
        if (toLoss.gt(0)) {
          const loss = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_REVALUATION_LOSS, date, profile, tx);
          lines.push(this.accounting.line(loss.id, 'DEBIT', toLoss, `Revaluation loss ${asset.assetNumber}`, { departmentId: asset.departmentId }));
        }
        lines.push(this.accounting.line(faCost.id, 'CREDIT', decrease, `Revaluation decrease ${asset.assetNumber}`, { assetId }));
      }
      const je = await this.accounting.post(tenantId, userId, { organizationId, businessDate: date, description: `Revaluation ${doc.number} — ${asset.assetNumber}`, sourceDocumentType: FaDocumentType.REVALUATION, sourceDocumentId: doc.id, lines }, tx);
      await this.documents.attachJournal(tx, doc.id, je?.id);
      await this.ledger.write(tx, {
        tenantId,
        organizationId,
        assetId,
        movementType: delta.gt(0) ? MovementType.REVALUATION_INCREASE : MovementType.REVALUATION_DECREASE,
        businessDate: date,
        revaluationIncrease: delta.gt(0) ? delta : 0,
        revaluationDecrease: delta.lt(0) ? delta.negated() : 0,
        departmentId: asset.departmentId,
        locationId: asset.locationId,
        sourceDocumentType: FaDocumentType.REVALUATION,
        sourceDocumentId: doc.id,
        journalEntryId: je?.id,
        description: dto.reason,
        createdBy: userId,
      });
      await this.ledger.refreshProjection(tx, tenantId, assetId);
      await this.audit.record({ tenantId, eventType: 'FixedAssetRevalued', entityType: 'FixedAsset', entityId: assetId, action: 'REVALUE', userId, oldValues: { carryingAmount: b.netBookValue.toString() }, newValues: { fairValue: fair.toString(), delta: delta.toString(), documentId: doc.id }, reason: dto.reason }, tx);
      return { ...doc, journalEntryId: je?.id ?? null };
    });
  }
}
