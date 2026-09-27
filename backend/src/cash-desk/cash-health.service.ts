import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { CashBalanceService } from './cash-balance.service';

export interface CashHealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  cashboxId: string | null;
  documentType: string | null;
  documentId: string | null;
  message: string;
}

const STALE_DAYS = 7;
const TOLERANCE = new Decimal('0.01');

/**
 * CashHealthService (docx spec Phase 15, "Cash Health Checks", section
 * 94) — computed live, never a stored issues table, same principle as
 * TreasuryHealthService/SettlementHealthService. Covers: book-vs-GL
 * agreement per cash desk (the one check no other Phase 15 service
 * already surfaces), stale unresolved physical-count differences, daily
 * closes left open too long, and cash-desk transfers stuck in transit.
 */
@Injectable()
export class CashHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly cashBalance: CashBalanceService,
  ) {}

  async check(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ): Promise<CashHealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: CashHealthIssue[] = [];
    const now = new Date();

    const cashboxes = await this.prisma.cashbox.findMany({
      where: { organizationId, active: true },
    });
    const cashboxDim =
      await this.prisma.accountingDimensionDefinition.findFirst({
        where: { code: 'CASHBOX', OR: [{ tenantId }, { tenantId: null }] },
      });
    let cashAccountId: string | null = null;
    try {
      cashAccountId = (
        await this.mappings.resolve(
          tenantId,
          organizationId,
          MappingKeys.CASH,
          now,
        )
      ).id;
    } catch {
      // No CASH mapping configured for this org yet — book-vs-GL check skipped below.
    }

    for (const cashbox of cashboxes) {
      const bookBalance = await this.cashBalance.getBookBalance(
        tenantId,
        cashbox.id,
        now,
      );

      if (bookBalance.lt(0) && cashbox.negativeBalancePolicy === 'NEVER') {
        issues.push({
          severity: 'ERROR',
          code: 'NEGATIVE_BALANCE_UNDER_NEVER_POLICY',
          cashboxId: cashbox.id,
          documentType: null,
          documentId: null,
          message: `Cash desk ${cashbox.code} has a negative book balance (${bookBalance.toFixed(2)}) despite its NEVER negative-balance policy`,
        });
      }

      if (cashAccountId && cashboxDim) {
        const lines = await this.prisma.journalEntryLine.findMany({
          where: {
            accountId: cashAccountId,
            journalEntry: { tenantId, organizationId, status: 'POSTED' },
            dimensions: {
              some: {
                dimensionDefinitionId: cashboxDim.id,
                referenceId: cashbox.id,
              },
            },
          },
        });
        const glBalance = lines.reduce(
          (sum, l) =>
            l.side === 'DEBIT'
              ? sum.plus(l.amountBase.toString())
              : sum.minus(l.amountBase.toString()),
          new Decimal(0),
        );
        if (bookBalance.minus(glBalance).abs().gt(TOLERANCE)) {
          issues.push({
            severity: 'ERROR',
            code: 'CASH_BOOK_GL_MISMATCH',
            cashboxId: cashbox.id,
            documentType: null,
            documentId: null,
            message: `Cash desk ${cashbox.code} book balance (${bookBalance.toFixed(2)}) does not match its GL balance (${glBalance.toFixed(2)})`,
          });
        }
      }
    }

    const staleCutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000);

    const unresolvedCounts = await this.prisma.cashPhysicalCount.findMany({
      where: { organizationId, status: 'APPROVED' },
    });
    for (const count of unresolvedCounts) {
      if (
        !count.difference ||
        new Decimal(count.difference.toString()).isZero()
      )
        continue;
      if (count.approvedAt && count.approvedAt > staleCutoff) continue;
      const adjustment = await this.prisma.cashCountAdjustment.findFirst({
        where: { countId: count.id },
      });
      if (adjustment && adjustment.postingStatus === 'POSTED') continue;
      issues.push({
        severity: 'WARNING',
        code: 'STALE_UNRESOLVED_COUNT_DIFFERENCE',
        cashboxId: count.cashboxId,
        documentType: 'CASH_PHYSICAL_COUNT',
        documentId: count.id,
        message: `Physical count approved ${count.approvedAt?.toISOString().slice(0, 10) ?? ''} has an unresolved difference of ${count.difference.toString()} for over ${STALE_DAYS} days`,
      });
    }

    const openCloses = await this.prisma.cashDeskDailyClose.findMany({
      where: {
        organizationId,
        status: { notIn: ['CLOSED'] },
        businessDate: { lt: staleCutoff },
      },
    });
    for (const close of openCloses) {
      issues.push({
        severity: 'WARNING',
        code: 'STALE_OPEN_DAILY_CLOSE',
        cashboxId: close.cashboxId,
        documentType: 'CASH_DESK_DAILY_CLOSE',
        documentId: close.id,
        message: `Daily close for ${close.businessDate.toISOString().slice(0, 10)} is still ${close.status} after ${STALE_DAYS} days`,
      });
    }

    const stuckTransfers = await this.prisma.cashDeskTransfer.findMany({
      where: {
        organizationId,
        transferMode: 'TWO_STEP',
        transferState: { in: ['IN_TRANSIT', 'PARTIALLY_RECEIVED'] },
        postedAt: { lt: staleCutoff },
      },
    });
    for (const transfer of stuckTransfers) {
      issues.push({
        severity: 'WARNING',
        code: 'CASH_TRANSFER_STUCK_IN_TRANSIT',
        cashboxId: transfer.destinationCashboxId,
        documentType: 'CASH_DESK_TRANSFER',
        documentId: transfer.id,
        message: `Cash desk transfer ${transfer.number ?? transfer.id} shipped ${transfer.postedAt?.toISOString().slice(0, 10) ?? ''} is still ${transfer.transferState} after ${STALE_DAYS} days`,
      });
    }

    return issues;
  }
}
