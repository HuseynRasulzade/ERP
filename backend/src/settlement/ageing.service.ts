import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface AgeingBucketConfig {
  label: string;
  minDays: number; // inclusive
  maxDays: number | null; // exclusive upper bound, null = unbounded
}

const DEFAULT_BUCKETS: AgeingBucketConfig[] = [
  { label: 'NOT_DUE', minDays: -Infinity, maxDays: 1 },
  { label: '1_30', minDays: 1, maxDays: 31 },
  { label: '31_60', minDays: 31, maxDays: 61 },
  { label: '61_90', minDays: 61, maxDays: 91 },
  { label: '91_180', minDays: 91, maxDays: 181 },
  { label: '181_365', minDays: 181, maxDays: 366 },
  { label: 'OVER_365', minDays: 366, maxDays: null },
];

/**
 * AgeingService (spec sections 68-74, 160-162). Ageing is computed
 * per OPEN ITEM (never invoice total, spec section 70) using
 * `remainingAmount` and `dueDate` only — a payment-schedule invoice
 * naturally ages each installment separately since each is its own
 * `SettlementObligation` row (spec section 71). Advances are excluded
 * entirely (spec section 72) — they are never queried here.
 */
@Injectable()
export class AgeingService {
  constructor(private readonly prisma: PrismaService) {}

  private bucketFor(days: number, buckets: AgeingBucketConfig[]): string {
    for (const b of buckets) {
      if (days >= b.minDays && (b.maxDays === null || days < b.maxDays)) return b.label;
    }
    return 'OVER_365';
  }

  async customerAgeing(tenantId: string, organizationId: string, asOfDate: Date = new Date(), buckets = DEFAULT_BUCKETS) {
    const items = await this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } } });
    return items.map((i) => this.rowFor(i, i.remainingAmount ?? i.amountDue, asOfDate, buckets));
  }

  async supplierAgeing(tenantId: string, organizationId: string, asOfDate: Date = new Date(), buckets = DEFAULT_BUCKETS) {
    const items = await this.prisma.supplierPayable.findMany({ where: { tenantId, organizationId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } } });
    return items.map((i) => this.rowFor(i, i.remainingAmount ?? i.invoiceAmount, asOfDate, buckets));
  }

  private rowFor(item: { id: string; counterpartyId: string; sourceDocumentType: string; sourceDocumentId: string; dueDate: Date | null; currencyId: string | null; disputedAmount?: unknown; collectionStatus?: string | null }, remaining: unknown, asOfDate: Date, buckets: AgeingBucketConfig[]) {
    const remainingAmount = new Decimal(String(remaining));
    const daysOverdue = item.dueDate ? Math.floor((asOfDate.getTime() - item.dueDate.getTime()) / 86_400_000) : -Infinity;
    return {
      openItemId: item.id,
      counterpartyId: item.counterpartyId,
      sourceDocumentType: item.sourceDocumentType,
      sourceDocumentId: item.sourceDocumentId,
      dueDate: item.dueDate,
      currencyId: item.currencyId,
      outstanding: remainingAmount.toString(),
      daysOverdue: Math.max(daysOverdue, 0),
      bucket: this.bucketFor(daysOverdue, buckets),
      disputed: item.disputedAmount ? new Decimal(String(item.disputedAmount)).gt(0) : false,
      collectionStatus: item.collectionStatus ?? 'NORMAL',
    };
  }

  async overdueSummary(tenantId: string, organizationId: string, counterpartyRole: 'CUSTOMER' | 'SUPPLIER', asOfDate: Date = new Date()) {
    const rows = counterpartyRole === 'CUSTOMER' ? await this.customerAgeing(tenantId, organizationId, asOfDate) : await this.supplierAgeing(tenantId, organizationId, asOfDate);
    const overdue = rows.filter((r) => r.daysOverdue > 0);
    const byCounterparty = new Map<string, { outstanding: Decimal; overdue: Decimal; maxDaysOverdue: number; oldestDueDate: Date | null }>();
    for (const r of rows) {
      const entry = byCounterparty.get(r.counterpartyId) ?? { outstanding: new Decimal(0), overdue: new Decimal(0), maxDaysOverdue: 0, oldestDueDate: null };
      entry.outstanding = entry.outstanding.plus(r.outstanding);
      if (r.daysOverdue > 0) entry.overdue = entry.overdue.plus(r.outstanding);
      entry.maxDaysOverdue = Math.max(entry.maxDaysOverdue, r.daysOverdue);
      if (r.dueDate && (!entry.oldestDueDate || r.dueDate < entry.oldestDueDate)) entry.oldestDueDate = r.dueDate;
      byCounterparty.set(r.counterpartyId, entry);
    }
    return Array.from(byCounterparty.entries()).map(([counterpartyId, v]) => ({ counterpartyId, outstanding: v.outstanding.toString(), overdue: v.overdue.toString(), maxDaysOverdue: v.maxDaysOverdue, oldestDueDate: v.oldestDueDate }));
  }
}
