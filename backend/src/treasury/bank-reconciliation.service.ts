import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateBankStatementLineDto, MatchBankStatementLineDto, UpdateBankStatementLineDto } from './dto/bank-reconciliation.dto';
import { PaymentOrderService } from './payment-order.service';

const BANK_STATEMENT_LINE_TYPE = 'BANK_STATEMENT_LINE';

/**
 * Bank reconciliation (Barışdırma) — statement-line-based matching, on
 * top of PaymentOrder.reconcile()'s existing single-amount field rather
 * than beside it: matching a line to a PaymentOrder calls that same
 * `reconcile()` method (so PaymentOrder.reconciled/bankStatementAmount
 * never disagrees with this line's own MATCHED status), then records the
 * link on the line's own side. No file-import parser exists in this
 * build — lines are entered the same way every other document here is:
 * one row at a time, honestly labeled as manual entry.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly paymentOrders: PaymentOrderService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, bankAccountId?: string, status?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.bankStatementLine.findMany({
      where: { organizationId, ...(bankAccountId ? { bankAccountId } : {}), ...(status ? { status } : {}) },
      orderBy: { statementDate: 'desc' },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateBankStatementLineDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccount = await this.prisma.bankAccount.findFirst({ where: { id: dto.bankAccountId, organizationId } });
    if (!bankAccount) throw new ValidationAppError('Bank account does not belong to this organization');

    const created = await this.prisma.bankStatementLine.create({
      data: {
        tenantId,
        organizationId,
        bankAccountId: dto.bankAccountId,
        statementDate: this.parseDate(dto.statementDate),
        description: dto.description,
        reference: dto.reference,
        amount: new Decimal(dto.amount.toString()),
        createdBy: userId,
      },
    });

    await this.audit.record({ tenantId, eventType: 'BANK_STATEMENT_LINE_CREATED', entityType: BANK_STATEMENT_LINE_TYPE, entityId: created.id, action: 'CREATE', userId, newValues: { amount: created.amount.toString() } });
    return created;
  }

  /**
   * Header-field edit, only while `status === 'UNMATCHED'` — once a line
   * is matched, editing it would let its amount silently drift from the
   * PaymentOrder.reconcile() call `match()` already made, so it's locked
   * the same way a posted document is locked elsewhere in this codebase.
   */
  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, dto: UpdateBankStatementLineDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id, organizationId } });
    if (!line) throw new NotFoundAppError('BankStatementLine', id);
    if (line.status === 'MATCHED') throw new ValidationAppError('A matched statement line cannot be edited — unmatch is not supported, delete and re-enter if needed');

    const result = await this.prisma.bankStatementLine.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        ...(dto.statementDate !== undefined ? { statementDate: this.parseDate(dto.statementDate) } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.amount !== undefined ? { amount: new Decimal(dto.amount.toString()) } : {}),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({ tenantId, eventType: 'BANK_STATEMENT_LINE_UPDATED', entityType: BANK_STATEMENT_LINE_TYPE, entityId: id, action: 'UPDATE', userId, newValues: dto });
    return this.prisma.bankStatementLine.findFirst({ where: { id } });
  }

  /**
   * Matches a statement line to the PaymentOrder it clears. Amount must
   * match exactly (a PaymentOrder is always an outflow, so the line must
   * be a negative of the same magnitude) — no fuzzy/tolerance matching,
   * so a mismatch surfaces as a clear validation error rather than a
   * silently-wrong reconciliation.
   */
  async match(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, dto: MatchBankStatementLineDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id, organizationId } });
    if (!line) throw new NotFoundAppError('BankStatementLine', id);
    if (line.status === 'MATCHED') throw new ValidationAppError('This statement line is already matched');

    const order = await this.prisma.paymentOrder.findFirst({ where: { id: dto.documentId, organizationId } });
    if (!order) throw new ValidationAppError('Payment order does not belong to this organization');
    if (order.bankAccountId !== line.bankAccountId) throw new ValidationAppError("Payment order's bank account does not match this statement line's bank account");
    if (order.reconciled) throw new ValidationAppError('This payment order is already reconciled');

    const lineAmount = new Decimal(line.amount.toString());
    const orderAmount = new Decimal(order.amount.toString());
    if (!lineAmount.neg().eq(orderAmount)) {
      throw new ValidationAppError(`Amount mismatch: statement line is ${lineAmount.toString()}, payment order is ${orderAmount.toString()} (expected ${orderAmount.neg().toString()})`);
    }

    await this.paymentOrders.reconcile(tenantId, membershipId, organizationId, order.id, userId, {
      expectedVersion: order.version,
      bankStatementAmount: lineAmount.neg().toNumber(),
    });

    const updated = await this.prisma.bankStatementLine.update({
      where: { id },
      data: { status: 'MATCHED', matchedDocumentType: 'PAYMENT_ORDER', matchedDocumentId: order.id, matchedAt: new Date(), matchedBy: userId, version: { increment: 1 } },
    });

    await this.audit.record({ tenantId, eventType: 'BANK_STATEMENT_LINE_MATCHED', entityType: BANK_STATEMENT_LINE_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { matchedDocumentId: order.id } });
    return updated;
  }

  /**
   * CSV bank statement import (Bank çıxarışı idxalı) — this build has no
   * bank-specific format parser (MT940 etc.), so it accepts one plain,
   * bank-agnostic shape: a header row naming `date,description,reference,
   * amount` in any order/case, one line per statement entry. Rows whose
   * (date, amount, reference, description) tuple already exists for this
   * bank account are skipped as likely re-imports of the same file,
   * rather than silently duplicated — the summary reports exactly which
   * rows landed where so the user can fix and re-upload just the rest.
   */
  async importCsv(tenantId: string, membershipId: string, organizationId: string, bankAccountId: string, userId: string, csvText: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccount = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, organizationId } });
    if (!bankAccount) throw new ValidationAppError('Bank account does not belong to this organization');

    const rows = this.parseCsv(csvText);
    if (rows.length === 0) throw new ValidationAppError('CSV file has no data rows');

    const existing = await this.prisma.bankStatementLine.findMany({ where: { bankAccountId } });
    const existingKeys = new Set(
      existing.map((l) => this.dedupeKey(l.statementDate.toISOString().slice(0, 10), l.amount.toString(), l.reference ?? '', l.description ?? '')),
    );

    const toCreate: { statementDate: Date; description?: string; reference?: string; amount: string }[] = [];
    const errors: { row: number; message: string }[] = [];
    let skipped = 0;

    rows.forEach((row, index) => {
      try {
        const date = this.parseDate(row.date);
        const amount = new Decimal(row.amount);
        if (!amount.isFinite() || amount.isZero()) throw new ValidationAppError('Amount must be a non-zero number');
        const key = this.dedupeKey(date.toISOString().slice(0, 10), amount.toString(), row.reference ?? '', row.description ?? '');
        if (existingKeys.has(key)) { skipped += 1; return; }
        existingKeys.add(key); // dedupe within the same file too
        toCreate.push({ statementDate: date, description: row.description, reference: row.reference, amount: amount.toString() });
      } catch (err) {
        errors.push({ row: index + 2, message: err instanceof Error ? err.message : 'Invalid row' }); // +2: 1-indexed + header row
      }
    });

    const created = await this.prisma.runInTransaction(async (tx) => {
      const rows = await Promise.all(
        toCreate.map((row) =>
          tx.bankStatementLine.create({
            data: {
              tenantId,
              organizationId,
              bankAccountId,
              statementDate: row.statementDate,
              description: row.description,
              reference: row.reference,
              amount: new Decimal(row.amount),
              createdBy: userId,
            },
          }),
        ),
      );
      if (rows.length > 0) {
        await this.audit.record(
          { tenantId, eventType: 'BANK_STATEMENT_IMPORTED', entityType: BANK_STATEMENT_LINE_TYPE, entityId: bankAccountId, action: 'CREATE', userId, newValues: { imported: rows.length, skipped, errors: errors.length } },
          tx,
        );
      }
      return rows;
    });

    return { imported: created.length, skipped, errors, lines: created };
  }

  private dedupeKey(dateIso: string, amount: string, reference: string, description: string): string {
    return `${dateIso}|${amount}|${reference.trim().toLowerCase()}|${description.trim().toLowerCase()}`;
  }

  /** Minimal CSV parser (no external dependency) — handles double-quoted
   * fields containing commas/quotes (RFC 4180 `""` escaping), which is
   * as much as a bank-agnostic export format needs. Column order is read
   * from the header row so `date,amount,description,reference` and
   * `reference,date,description,amount` both work. */
  private parseCsv(text: string): { date: string; description?: string; reference?: string; amount: string }[] {
    const splitLine = (line: string): string[] => {
      const fields: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { current += ch; }
        } else if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      fields.push(current);
      return fields.map((f) => f.trim());
    };

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const header = splitLine(lines[0]).map((h) => h.toLowerCase());
    const dateIdx = header.indexOf('date');
    const amountIdx = header.indexOf('amount');
    const descriptionIdx = header.indexOf('description');
    const referenceIdx = header.indexOf('reference');
    if (dateIdx === -1 || amountIdx === -1) {
      throw new ValidationAppError('CSV header must include at least "date" and "amount" columns');
    }

    return lines.slice(1).map((line) => {
      const fields = splitLine(line);
      return {
        date: fields[dateIdx] ?? '',
        amount: fields[amountIdx] ?? '',
        description: descriptionIdx >= 0 ? fields[descriptionIdx] || undefined : undefined,
        reference: referenceIdx >= 0 ? fields[referenceIdx] || undefined : undefined,
      };
    });
  }

  /** Auto-match suggestions (Bank çıxarışı idxalı) — for an UNMATCHED
   * line, every POSTED, not-yet-reconciled PaymentOrder on the same bank
   * account whose amount exactly clears it (a PaymentOrder is always an
   * outflow, so its amount must equal the negative of the line's own),
   * nearest statement date first. Same exact-match rule `match()` itself
   * enforces — this only surfaces candidates, it never matches for the
   * user. */
  async suggestMatches(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id, organizationId } });
    if (!line) throw new NotFoundAppError('BankStatementLine', id);
    if (line.status === 'MATCHED') return [];

    const targetAmount = new Decimal(line.amount.toString()).neg();
    const candidates = await this.prisma.paymentOrder.findMany({
      where: { tenantId, organizationId, bankAccountId: line.bankAccountId, postingStatus: 'POSTED', reconciled: false, amount: targetAmount.toString() },
    });

    return candidates
      .map((order) => ({ ...order, dateDeltaDays: Math.abs((order.documentDate.getTime() - line.statementDate.getTime()) / 86_400_000) }))
      .sort((a, b) => a.dateDeltaDays - b.dateDeltaDays);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid statement date');
    return date;
  }
}
