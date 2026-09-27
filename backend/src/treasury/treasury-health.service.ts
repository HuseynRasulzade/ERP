import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface TreasuryHealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  code: string;
  bankAccountId: string | null;
  documentType: string | null;
  documentId: string | null;
  message: string;
}

const STALE_UNMATCHED_DAYS = 14;

/**
 * TreasuryHealthService (spec sections 141-142) — computed live, never a
 * stored issues table (same principle as SettlementHealthService). Covers
 * the subset of the spec's own minimum checklist expressible from this
 * phase's own tables; Bank-vs-GL reconciliation itself (spec section 143)
 * is Phase 30's job — this only surfaces the discrepancy DATA that phase
 * needs (a reconciliation still DIFFERENCE_FOUND).
 */
@Injectable()
export class TreasuryHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async check(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ): Promise<TreasuryHealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: TreasuryHealthIssue[] = [];
    const now = new Date();

    // Approved request overdue and still not fully executed.
    const requests = await this.prisma.paymentRequest.findMany({
      where: {
        organizationId,
        approvalStatus: 'APPROVED',
        status: { notIn: ['CANCELLED', 'FULFILLED'] },
      },
    });
    for (const request of requests) {
      if (!request.requestedPaymentDate || request.requestedPaymentDate >= now)
        continue;
      const orders = await this.prisma.paymentOrder.findMany({
        where: { paymentRequestId: request.id, status: { not: 'CANCELLED' } },
      });
      const executed = orders
        .filter((o) => o.postingStatus === 'POSTED')
        .reduce((s, o) => s.plus(o.amount.toString()), new Decimal(0));
      const approvedCap =
        request.approvedAmount != null
          ? new Decimal(request.approvedAmount.toString())
          : new Decimal(request.amount.toString());
      if (executed.lt(approvedCap)) {
        issues.push({
          severity: 'WARNING',
          code: 'OVERDUE_APPROVED_REQUEST_UNPAID',
          bankAccountId: null,
          documentType: 'PAYMENT_REQUEST',
          documentId: request.id,
          message: `Payment request ${request.number ?? request.id} was due ${request.requestedPaymentDate.toISOString().slice(0, 10)} and still has ${approvedCap.minus(executed).toFixed(2)} unexecuted`,
        });
      }
    }

    // Statement lines sitting unmatched too long.
    const staleCutoff = new Date(
      now.getTime() - STALE_UNMATCHED_DAYS * 86_400_000,
    );
    const staleLines = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        status: 'UNMATCHED',
        statementDate: { lt: staleCutoff },
      },
    });
    for (const line of staleLines) {
      issues.push({
        severity: 'WARNING',
        code: 'STATEMENT_LINE_UNMATCHED_TOO_LONG',
        bankAccountId: line.bankAccountId,
        documentType: 'BANK_STATEMENT_LINE',
        documentId: line.id,
        message: `Statement line dated ${line.statementDate.toISOString().slice(0, 10)} (${line.amount.toString()}) has been unmatched for over ${STALE_UNMATCHED_DAYS} days`,
      });
    }

    // Reconciliation still showing a difference.
    const openReconciliations = await this.prisma.bankReconciliation.findMany({
      where: {
        organizationId,
        status: { in: ['DIFFERENCE_FOUND', 'DRAFT', 'IN_PROGRESS'] },
      },
    });
    for (const rec of openReconciliations) {
      if (
        rec.difference != null &&
        new Decimal(rec.difference.toString()).abs().gt(0.01)
      ) {
        issues.push({
          severity: 'ERROR',
          code: 'RECONCILIATION_DIFFERENCE',
          bankAccountId: rec.bankAccountId,
          documentType: 'BANK_RECONCILIATION',
          documentId: rec.id,
          message: `Reconciliation for ${rec.periodStart.toISOString().slice(0, 10)}–${rec.periodEnd.toISOString().slice(0, 10)} has an unexplained difference of ${rec.difference.toString()}`,
        });
      }
    }

    // Missing statement period (spec section 98): a gap between one closed
    // reconciliation's periodEnd and the next one's periodStart.
    const byAccount = new Map<string, typeof openReconciliations>();
    const all = await this.prisma.bankReconciliation.findMany({
      where: { organizationId },
      orderBy: { periodStart: 'asc' },
    });
    for (const rec of all)
      byAccount.set(rec.bankAccountId, [
        ...(byAccount.get(rec.bankAccountId) ?? []),
        rec,
      ]);
    for (const [bankAccountId, recs] of byAccount) {
      for (let i = 1; i < recs.length; i++) {
        const gapDays =
          Math.round(
            (recs[i].periodStart.getTime() - recs[i - 1].periodEnd.getTime()) /
              86_400_000,
          ) - 1;
        if (gapDays > 0) {
          issues.push({
            severity: 'WARNING',
            code: 'MISSING_STATEMENT_PERIOD',
            bankAccountId,
            documentType: 'BANK_RECONCILIATION',
            documentId: recs[i].id,
            message: `${gapDays} day(s) gap between reconciliation periods ending ${recs[i - 1].periodEnd.toISOString().slice(0, 10)} and starting ${recs[i].periodStart.toISOString().slice(0, 10)}`,
          });
        }
      }
    }

    return issues;
  }
}
