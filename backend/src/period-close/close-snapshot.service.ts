import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CloseSnapshotService (docx spec Phase 22, sections 110-113). Captures
 * references/checksums, not a duplicate copy of every subledger table —
 * "what did the system know when this period was closed" is answered by
 * re-querying those tables AS OF `businessDate <= periodEnd` plus this
 * snapshot's own checksum as a tamper/drift check, not by physically
 * freezing a copy of every row (disclosed simplification,
 * docs/MONTH_CLOSE.md section K). Immutable once created — a reclose
 * creates a NEW snapshot row (version + 1) rather than overwriting.
 */
@Injectable()
export class CloseSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, financialPeriodId: string, closeRunId: string, organizationId: string, periodEnd: Date) {
    const trialBalance = await this.prisma.accountingMovement.groupBy({
      by: ['accountId', 'side'],
      where: { tenantId, organizationId, businessDate: { lte: periodEnd } },
      _sum: { amountBase: true },
    });
    const rows = trialBalance
      .map((r) => `${r.accountId}|${r.side}|${r._sum.amountBase?.toString() ?? '0'}`)
      .sort(); // order-independent — groupBy's own row order is not guaranteed stable
    const trialBalanceChecksum = createHash('sha256').update(rows.join('\n')).digest('hex');

    const previousVersion = await this.prisma.periodCloseSnapshot.count({ where: { tenantId, financialPeriodId } });
    const reconciliationResults = await this.prisma.periodReconciliationResult.findMany({ where: { tenantId, closeRunId } });
    const issues = await this.prisma.periodCloseIssue.findMany({ where: { tenantId, closeRunId } });

    return this.prisma.periodCloseSnapshot.create({
      data: {
        tenantId,
        financialPeriodId,
        closeRunId,
        version: previousVersion + 1,
        trialBalanceChecksum,
        snapshotData: {
          accountBalanceCount: trialBalance.length,
          reconciliationResultCount: reconciliationResults.length,
          reconciliationStatuses: reconciliationResults.map((r) => ({ ruleId: r.ruleId, status: r.status })),
          openIssueCount: issues.filter((i) => i.status === 'OPEN').length,
          periodEnd: periodEnd.toISOString(),
        },
      },
    });
  }
}
