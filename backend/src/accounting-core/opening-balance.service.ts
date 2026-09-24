import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AuditService } from '../audit/audit.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingPostingEngine, AccountingPostingLineInput } from './accounting-posting-engine.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * Opening balances (Accounting Core spec sections 53-55). Balances enter
 * the ledger ONLY as a controlled, balanced accounting operation through
 * AccountingPostingEngine — never by setting an account balance — and are
 * flagged `operationType = OPENING_BALANCE`, `isOpeningBalance = true`,
 * `generatedBy = OPENING_BALANCE` so reports and audit can tell them apart.
 *
 * Every line is supplied by the caller, including any equity/clearing
 * balancing line (spec section 54: "every balancing line must be visible")
 * — the engine rejects an unbalanced batch rather than inventing a hidden
 * correction. Period guard, dimension rules/integrity and currency/quantity
 * rules all apply exactly as for any other posting.
 */
@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
    private readonly charts: ChartOfAccountsService,
    private readonly engine: AccountingPostingEngine,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.journalEntry.findMany({
      where: { tenantId, organizationId, isOpeningBalance: true },
      include: { lines: { include: { dimensions: true }, orderBy: { sequence: 'asc' } } },
      orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async post(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { businessDate: string; description?: string; lines: AccountingPostingLineInput[] },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.charts.ensureAdopted(tenantId);
    const businessDate = parseDate(dto.businessDate);

    return this.prisma.runInTransaction(async (tx) => {
      const entry = await this.engine.postBatch(
        tenantId,
        userId,
        {
          organizationId,
          businessDate,
          postingDate: businessDate,
          description: dto.description ?? 'Opening balance',
          operationType: 'OPENING_BALANCE',
          generatedBy: 'OPENING_BALANCE',
          isOpeningBalance: true,
          lines: dto.lines,
        },
        tx,
      );
      await this.audit.record(
        {
          tenantId,
          eventType: 'OPENING_BALANCE_POSTED',
          entityType: 'JournalEntry',
          entityId: entry!.id,
          action: 'POST',
          userId,
          newValues: { journalNumber: entry!.journalNumber, businessDate: dto.businessDate, lineCount: dto.lines.length },
        },
        tx,
      );
      return entry;
    });
  }

  /** Corrections go through an explicit, visible reversal (spec section 48) —
   * an opening balance is never edited or silently deleted. */
  async reverse(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId, organizationId, isOpeningBalance: true, isReversal: false },
    });
    if (!entry) throw new NotFoundAppError('OpeningBalance', id);
    return this.engine.reverse(tenantId, id, userId, expectedVersion);
  }
}

function parseDate(s: string): Date {
  const d = new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
  if (Number.isNaN(d.getTime())) throw new ValidationAppError(`Invalid businessDate: ${s}`);
  return d;
}
