import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { Books, FaDocumentType, MovementType, RECOGNIZED_STATUSES, dec, formatAmount, toDate } from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { FixedAssetInvalidStateError, FixedAssetPolicyViolationError } from './fixed-asset.errors';

export interface ImpairDto {
  date: string;
  recoverableAmount: number;
  reason: string;
  valuationSource?: string;
  approvalReference?: string;
}

/**
 * FixedAssetImpairmentService (spec sections 52-56, 153): impairment =
 * carrying amount - recoverable amount, posted Dr FA_IMPAIRMENT_LOSS /
 * Cr FA_ACCUMULATED_IMPAIRMENT with an IMPAIRMENT movement. Future
 * depreciation needs no special handling: the straight-line strategy is
 * prospective on the carrying amount, so it adjusts automatically while
 * every past period stays untouched.
 */
@Injectable()
export class FixedAssetImpairmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly documents: FixedAssetDocumentService,
    private readonly policies: DepreciationPolicyService,
  ) {}

  async impair(tenantId: string, membershipId: string, organizationId: string, assetId: string, userId: string, dto: ImpairDto) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.IMPAIRMENT);
    const date = toDate(dto.date);
    const recoverable = dec(dto.recoverableAmount);
    if (recoverable.lt(0)) throw new FixedAssetPolicyViolationError('Recoverable amount cannot be negative');

    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (!RECOGNIZED_STATUSES.includes(asset.status)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; it cannot be impaired.`);
      const b = await this.ledger.balances(tenantId, assetId, { tx });
      const impairment = b.netBookValue.minus(recoverable);
      if (impairment.lte(0)) {
        throw new FixedAssetPolicyViolationError(`Recoverable amount ${formatAmount(recoverable)} is not below the carrying amount ${formatAmount(b.netBookValue)} of ${asset.assetNumber}; there is no impairment.`);
      }
      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.IMPAIRMENT,
        documentDate: date,
        userId,
        reason: dto.reason,
        valuationSource: dto.valuationSource,
        approvalReference: dto.approvalReference,
        description: `Impairment of ${asset.assetNumber}`,
        lines: [
          {
            assetId,
            costBefore: b.cost.toString(),
            accumulatedDepreciationBefore: b.accumulatedDepreciation.toString(),
            impairmentBefore: b.impairment.toString(),
            revaluationBefore: b.revaluation.toString(),
            carryingAmountBefore: b.netBookValue.toString(),
            recoverableAmount: recoverable.toString(),
            amount: impairment.toString(),
            carryingAmountAfter: recoverable.toString(),
          },
        ],
      });
      const profile = asset.category.accountingMappingProfile;
      const loss = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_IMPAIRMENT_LOSS, date, profile, tx);
      const accImp = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_ACCUMULATED_IMPAIRMENT, date, profile, tx);
      const je = await this.accounting.post(
        tenantId,
        userId,
        {
          organizationId,
          businessDate: date,
          description: `Impairment ${doc.number} — ${asset.assetNumber}`,
          sourceDocumentType: FaDocumentType.IMPAIRMENT,
          sourceDocumentId: doc.id,
          lines: [
            this.accounting.line(loss.id, 'DEBIT', impairment, `Impairment loss ${asset.assetNumber}`, { departmentId: asset.departmentId }),
            this.accounting.line(accImp.id, 'CREDIT', impairment, `Accumulated impairment ${asset.assetNumber}`, { assetId }),
          ],
        },
        tx,
      );
      await this.documents.attachJournal(tx, doc.id, je?.id);
      await this.ledger.write(tx, {
        tenantId, organizationId, assetId, movementType: MovementType.IMPAIRMENT, businessDate: date, impairmentIncrease: impairment,
        departmentId: asset.departmentId, locationId: asset.locationId, sourceDocumentType: FaDocumentType.IMPAIRMENT, sourceDocumentId: doc.id,
        sourceDocumentLineId: doc.lines[0].id, journalEntryId: je?.id, description: dto.reason, createdBy: userId,
      });
      const after = await this.ledger.refreshProjection(tx, tenantId, assetId);
      await this.audit.record(
        { tenantId, eventType: 'FixedAssetImpaired', entityType: 'FixedAsset', entityId: assetId, action: 'IMPAIR', userId, oldValues: { carryingAmount: b.netBookValue.toString() }, newValues: { recoverableAmount: recoverable.toString(), impairment: impairment.toString(), carryingAmount: after.netBookValue.toString(), documentId: doc.id, journalEntryId: je?.id }, reason: dto.reason },
        tx,
      );
      return { ...doc, journalEntryId: je?.id ?? null };
    });
  }

  /** Impairment reversal (spec section 56): only if the policy permits, and
   * never above the recognized impairment nor above the carrying amount
   * the asset would have had without impairment (cost + revaluation -
   * accumulated depreciation, as recorded). */
  async reverseImpairment(tenantId: string, membershipId: string, organizationId: string, assetId: string, userId: string, dto: ImpairDto) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.IMPAIRMENT_REVERSAL);
    const date = toDate(dto.date);
    const recoverable = dec(dto.recoverableAmount);

    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      const policy = await this.policies.resolvePolicy(tenantId, organizationId, asset.categoryId, date, Books.ACCOUNTING_BOOK, tx);
      if (!policy.impairmentReversalAllowed) throw new FixedAssetPolicyViolationError('Impairment reversal is not permitted by the accounting policy.');
      const b = await this.ledger.balances(tenantId, assetId, { tx });
      if (b.impairment.lte(0)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} has no accumulated impairment to reverse.`);
      const withoutImpairment = b.grossCarrying.minus(b.accumulatedDepreciation);
      const target = Decimal.min(recoverable, withoutImpairment);
      let reversal = target.minus(b.netBookValue);
      if (reversal.gt(b.impairment)) reversal = b.impairment;
      if (reversal.lte(0)) throw new FixedAssetPolicyViolationError(`Recoverable amount ${formatAmount(recoverable)} does not exceed the carrying amount ${formatAmount(b.netBookValue)}; nothing to reverse.`);

      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.IMPAIRMENT_REVERSAL,
        documentDate: date,
        userId,
        reason: dto.reason,
        valuationSource: dto.valuationSource,
        approvalReference: dto.approvalReference,
        description: `Impairment reversal ${asset.assetNumber}`,
        lines: [{ assetId, impairmentBefore: b.impairment.toString(), carryingAmountBefore: b.netBookValue.toString(), recoverableAmount: recoverable.toString(), amount: reversal.toString(), carryingAmountAfter: b.netBookValue.plus(reversal).toString() }],
      });
      const profile = asset.category.accountingMappingProfile;
      const accImp = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_ACCUMULATED_IMPAIRMENT, date, profile, tx);
      const gain = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_IMPAIRMENT_REVERSAL_GAIN, date, profile, tx);
      const je = await this.accounting.post(
        tenantId,
        userId,
        {
          organizationId,
          businessDate: date,
          description: `Impairment reversal ${doc.number} — ${asset.assetNumber}`,
          sourceDocumentType: FaDocumentType.IMPAIRMENT_REVERSAL,
          sourceDocumentId: doc.id,
          lines: [this.accounting.line(accImp.id, 'DEBIT', reversal, `Accumulated impairment ${asset.assetNumber}`, { assetId }), this.accounting.line(gain.id, 'CREDIT', reversal, `Impairment reversal ${asset.assetNumber}`)],
        },
        tx,
      );
      await this.documents.attachJournal(tx, doc.id, je?.id);
      await this.ledger.write(tx, { tenantId, organizationId, assetId, movementType: MovementType.IMPAIRMENT_REVERSAL, businessDate: date, impairmentDecrease: reversal, departmentId: asset.departmentId, locationId: asset.locationId, sourceDocumentType: FaDocumentType.IMPAIRMENT_REVERSAL, sourceDocumentId: doc.id, journalEntryId: je?.id, description: dto.reason, createdBy: userId });
      await this.ledger.refreshProjection(tx, tenantId, assetId);
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_IMPAIRMENT_REVERSED', entityType: 'FixedAsset', entityId: assetId, action: 'IMPAIRMENT_REVERSAL', userId, newValues: { reversal: reversal.toString(), documentId: doc.id }, reason: dto.reason }, tx);
      return { ...doc, journalEntryId: je?.id ?? null };
    });
  }
}
