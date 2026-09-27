import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

const DEFAULT_BUCKETS: { code: string; minDays: number; maxDays: number | null }[] = [
  { code: 'NOT_DUE', minDays: -Infinity as unknown as number, maxDays: 0 },
  { code: '1_30', minDays: 1, maxDays: 30 },
  { code: '31_60', minDays: 31, maxDays: 60 },
  { code: '61_90', minDays: 61, maxDays: 90 },
  { code: '91_180', minDays: 91, maxDays: 180 },
  { code: '181_365', minDays: 181, maxDays: 365 },
  { code: 'OVER_365', minDays: 366, maxDays: null },
];

export interface AgeingRow {
  openItemId: string;
  counterpartyId: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber: string | null;
  contractId: string | null;
  currencyId: string | null;
  dueDate: string | null;
  originalAmount: string;
  outstanding: string;
  daysOverdue: number;
  bucket: string;
}

/**
 * AgeingService (spec sections 68-74) — due-date based, never document-
 * date based (section 68), and always on the item's remaining balance,
 * never its original amount (section 70) — a 1,000 invoice with 600 paid
 * ages on the 400 that is actually still outstanding. Advances are
 * excluded entirely (section 72 — never counted as overdue receivable).
 */
@Injectable()
export class AgeingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async ageing(tenantId: string, membershipId: string, organizationId: string, role: 'CUSTOMER' | 'SUPPLIER', asOfDate: Date = new Date()): Promise<AgeingRow[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const itemType = role === 'CUSTOMER' ? 'RECEIVABLE' : 'PAYABLE';
    const items = await this.prisma.settlementOpenItem.findMany({
      where: { tenantId, organizationId, itemType, status: { notIn: ['SETTLED', 'CANCELLED'] } },
      orderBy: { dueDate: 'asc' },
    });

    return items
      .map((item) => {
        const outstanding = new Decimal(item.remainingAmount.toString());
        const daysOverdue = item.dueDate ? Math.max(0, Math.floor((asOfDate.getTime() - item.dueDate.getTime()) / 86_400_000)) : 0;
        return {
          openItemId: item.id,
          counterpartyId: item.counterpartyId,
          sourceDocumentType: item.sourceDocumentType,
          sourceDocumentId: item.sourceDocumentId,
          sourceDocumentNumber: item.sourceDocumentNumber,
          contractId: item.contractId,
          currencyId: item.currencyId,
          dueDate: item.dueDate ? item.dueDate.toISOString().slice(0, 10) : null,
          originalAmount: item.originalAmount.toString(),
          outstanding: outstanding.toFixed(2),
          daysOverdue,
          bucket: this.bucketFor(daysOverdue),
        };
      })
      .filter((r) => new Decimal(r.outstanding).abs().gt(0.005));
  }

  private bucketFor(daysOverdue: number): string {
    for (const bucket of DEFAULT_BUCKETS) {
      if (daysOverdue >= bucket.minDays && (bucket.maxDays === null || daysOverdue <= bucket.maxDays)) return bucket.code;
    }
    return 'OVER_365';
  }
}
