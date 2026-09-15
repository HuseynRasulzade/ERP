import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface NormalizedStatementLine {
  transactionDate: string;
  valueDate?: string;
  bookingDate?: string;
  externalTransactionId?: string;
  bankReference?: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  currencyId: string;
  baseAmount?: number;
  counterpartyName?: string;
  counterpartyAccount?: string;
  counterpartyTaxId?: string;
  description?: string;
  bankOperationCode?: string;
}

/**
 * BankStatementImportService (spec sections 33-38, 96-99). Takes an
 * ALREADY-NORMALIZED row shape — concrete CSV/MT940/CAMT.053 parsers are
 * Phase 28's own adapter boundary (spec section 147); this service is the
 * shared core every future format adapter would call into. Raw payload is
 * preserved verbatim (spec section 37); duplicate statements/lines are
 * detected, never silently re-imported (spec section 38).
 */
@Injectable()
export class BankStatementImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async import(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { bankAccountId: string; statementNumber?: string; statementDate: string; periodStart: string; periodEnd: string; openingBalance: number; closingBalance: number; currencyId: string; importSource?: string; externalStatementId?: string; rawPayload?: string; lines: NormalizedStatementLine[] },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    if (dto.externalStatementId) {
      const existing = await this.prisma.bankStatement.findUnique({ where: { tenantId_bankAccountId_externalStatementId: { tenantId, bankAccountId: dto.bankAccountId, externalStatementId: dto.externalStatementId } } });
      if (existing) return existing; // spec test 165 — duplicate import is a no-op, not an error
    }

    // Overlapping-period warning (spec section 99) — not blocking by
    // default, surfaced via TreasuryHealthService instead.
    const totalCredits = dto.lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const totalDebits = dto.lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const expectedClosing = new Decimal(dto.openingBalance).plus(totalCredits).minus(totalDebits);
    if (!expectedClosing.minus(dto.closingBalance).abs().lte('0.02')) {
      throw new ValidationAppError(`Imported statement arithmetic does not balance: opening ${dto.openingBalance} + credits ${totalCredits.toString()} - debits ${totalDebits.toString()} = ${expectedClosing.toString()}, but closing balance given is ${dto.closingBalance}.`);
    }

    return this.prisma.runInTransaction(async (tx) => {
      const statement = await tx.bankStatement.create({
        data: {
          tenantId,
          organizationId,
          bankAccountId: dto.bankAccountId,
          statementNumber: dto.statementNumber,
          statementDate: new Date(dto.statementDate),
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
          openingBalance: dto.openingBalance.toString(),
          totalDebits: totalDebits.toString(),
          totalCredits: totalCredits.toString(),
          closingBalance: dto.closingBalance.toString(),
          currencyId: dto.currencyId,
          importSource: dto.importSource ?? 'MANUAL',
          externalStatementId: dto.externalStatementId,
          rawPayload: dto.rawPayload,
          importedBy: userId,
        },
      });

      let lineNumber = 0;
      let skippedDuplicates = 0;
      for (const line of dto.lines) {
        // Cross-statement duplicate candidate key (spec section 38).
        if (line.externalTransactionId) {
          const duplicate = await tx.bankStatementLine.findFirst({ where: { tenantId, externalTransactionId: line.externalTransactionId, statement: { bankAccountId: dto.bankAccountId } } });
          if (duplicate) {
            skippedDuplicates++;
            continue;
          }
        }
        await tx.bankStatementLine.create({
          data: {
            tenantId,
            statementId: statement.id,
            lineNumber: lineNumber++,
            transactionDate: new Date(line.transactionDate),
            valueDate: line.valueDate ? new Date(line.valueDate) : undefined,
            bookingDate: line.bookingDate ? new Date(line.bookingDate) : undefined,
            externalTransactionId: line.externalTransactionId,
            bankReference: line.bankReference,
            direction: line.direction,
            amount: line.amount.toString(),
            currencyId: line.currencyId,
            baseAmount: line.baseAmount?.toString(),
            counterpartyName: line.counterpartyName,
            counterpartyAccount: line.counterpartyAccount,
            counterpartyTaxId: line.counterpartyTaxId,
            description: line.description,
            bankOperationCode: line.bankOperationCode,
          },
        });
      }

      await this.audit.record({ tenantId, eventType: 'BANK_TRANSACTION_IMPORTED', entityType: 'BANK_STATEMENT', entityId: statement.id, action: 'CREATE', userId, newValues: { lineCount: dto.lines.length, skippedDuplicates } }, tx);
      return tx.bankStatement.findFirst({ where: { id: statement.id }, include: { lines: true } });
    });
  }

  /** Opening-balance continuity check (spec section 96). */
  async checkContinuity(tenantId: string, bankAccountId: string, newStatement: { periodStart: Date; openingBalance: number }) {
    const previous = await this.prisma.bankStatement.findFirst({ where: { tenantId, bankAccountId, periodEnd: { lt: newStatement.periodStart } }, orderBy: { periodEnd: 'desc' } });
    if (!previous) return { ok: true, message: null };
    const gap = !new Decimal(previous.closingBalance.toString()).minus(newStatement.openingBalance).abs().lte('0.01');
    return { ok: !gap, message: gap ? `Previous statement closed at ${previous.closingBalance.toString()} but this one opens at ${newStatement.openingBalance} — check for a missing statement period.` : null };
  }
}
