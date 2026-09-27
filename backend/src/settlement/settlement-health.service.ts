import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

const EPSILON = new Decimal('0.01');

export interface HealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  code: string;
  counterpartyId: string | null;
  documentType: string | null;
  documentId: string | null;
  amount: string | null;
  currencyId: string | null;
  message: string;
}

/**
 * SettlementHealthService (spec sections 114-115) — computed live, never
 * a stored issues table (same rebuildable-projection principle as
 * everything else in this phase). Covers the subset of the spec's own
 * minimum checklist expressible purely from this phase's own tables —
 * the AR/AP-vs-GL check (section 110) is a placeholder returning no
 * issues until Accounting Core exposes a per-dimension balance query to
 * compare against (disclosed in docs/SETTLEMENT.md).
 */
@Injectable()
export class SettlementHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async check(tenantId: string, membershipId: string, organizationId: string): Promise<HealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: HealthIssue[] = [];
    const items = await this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId } });

    for (const item of items) {
      const remaining = new Decimal(item.remainingAmount.toString());
      const remainingBase = new Decimal(item.remainingBaseAmount.toString());
      const isAdvance = item.itemType === 'CUSTOMER_ADVANCE' || item.itemType === 'SUPPLIER_ADVANCE';

      if (!isAdvance && remaining.isNegative()) {
        issues.push({ severity: 'INFO', code: 'NEGATIVE_REMAINING', counterpartyId: item.counterpartyId, documentType: item.sourceDocumentType, documentId: item.sourceDocumentId, amount: remaining.toFixed(2), currencyId: item.currencyId, message: `${item.itemType} ${item.sourceDocumentNumber ?? item.sourceDocumentId} has a negative remaining balance (a customer/supplier credit position)` });
      }
      if (isAdvance && remaining.isNegative()) {
        issues.push({ severity: 'ERROR', code: 'ADVANCE_NEGATIVE_BALANCE', counterpartyId: item.counterpartyId, documentType: item.sourceDocumentType, documentId: item.sourceDocumentId, amount: remaining.toFixed(2), currencyId: item.currencyId, message: `Advance ${item.id} has been over-applied and carries a negative balance` });
      }
      if (item.status === 'SETTLED' && remainingBase.abs().gt(EPSILON)) {
        issues.push({ severity: 'WARNING', code: 'SETTLED_WITH_RESIDUAL_BASE', counterpartyId: item.counterpartyId, documentType: item.sourceDocumentType, documentId: item.sourceDocumentId, amount: remainingBase.toFixed(2), currencyId: item.currencyId, message: `Settled item ${item.sourceDocumentNumber ?? item.sourceDocumentId} still carries a ${remainingBase.toFixed(2)} base-currency residual (FX/rounding)` });
      }
      if (!isAdvance && !item.dueDate && ['OPEN', 'PARTIALLY_SETTLED'].includes(item.status)) {
        issues.push({ severity: 'WARNING', code: 'MISSING_DUE_DATE', counterpartyId: item.counterpartyId, documentType: item.sourceDocumentType, documentId: item.sourceDocumentId, amount: null, currencyId: item.currencyId, message: `${item.itemType} ${item.sourceDocumentNumber ?? item.sourceDocumentId} has no due date` });
      }
    }

    const grouped = new Map<string, typeof items>();
    for (const item of items.filter((i) => i.status !== 'CANCELLED')) {
      const key = `${item.sourceDocumentType}::${item.sourceDocumentId}::${item.scheduleLineSequence ?? ''}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    for (const [, group] of grouped) {
      if (group.length > 1) {
        issues.push({ severity: 'ERROR', code: 'DUPLICATE_OPEN_ITEM', counterpartyId: group[0].counterpartyId, documentType: group[0].sourceDocumentType, documentId: group[0].sourceDocumentId, amount: null, currencyId: group[0].currencyId, message: `${group.length} open items exist for the same source document/schedule line` });
      }
    }

    const unallocated = items.filter((i) => (i.itemType === 'CUSTOMER_ADVANCE' || i.itemType === 'SUPPLIER_ADVANCE') && new Decimal(i.remainingAmount.toString()).abs().gt(EPSILON) && Date.now() - i.sourceDate.getTime() > 90 * 86_400_000);
    for (const item of unallocated) {
      issues.push({ severity: 'INFO', code: 'STALE_UNALLOCATED_PAYMENT', counterpartyId: item.counterpartyId, documentType: item.sourceDocumentType, documentId: item.sourceDocumentId, amount: item.remainingAmount.toString(), currencyId: item.currencyId, message: `Payment ${item.sourceDocumentId} has been unallocated for over 90 days` });
    }

    return issues;
  }
}
