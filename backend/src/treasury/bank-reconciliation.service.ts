import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  ClassifyAsBankFeeDto,
  CreateBankStatementLineDto,
  MatchBankStatementLineDto,
  UpdateBankStatementLineDto,
} from './dto/bank-reconciliation.dto';
import { BankFeeService } from './bank-fee.service';

const BANK_STATEMENT_LINE_TYPE = 'BANK_STATEMENT_LINE';

/** Resolves the expected (bankAccountId, signed amount) a candidate
 * document would clear a statement line for — the single place every
 * matchable document type's own sign convention is decided, instead of
 * repeating it in match()/suggestMatches() separately (spec section 41:
 * matching against PaymentOrder/IncomingBankPayment/InternalBankTransfer/
 * BankFee/FXConversion). */
async function resolveMatchCandidate(
  tx: any,
  tenantId: string,
  organizationId: string,
  documentType: string,
  documentId: string,
): Promise<{ bankAccountId: string; expectedAmount: Decimal } | null> {
  switch (documentType) {
    case 'PAYMENT_ORDER': {
      const order = await tx.paymentOrder.findFirst({
        where: { id: documentId, tenantId, organizationId },
      });
      return order
        ? {
            bankAccountId: order.bankAccountId,
            expectedAmount: new Decimal(order.amount.toString()).neg(),
          }
        : null;
    }
    case 'INCOMING_BANK_PAYMENT': {
      const payment = await tx.incomingBankPayment.findFirst({
        where: { id: documentId, tenantId, organizationId },
      });
      return payment
        ? {
            bankAccountId: payment.bankAccountId,
            expectedAmount: new Decimal(payment.amount.toString()),
          }
        : null;
    }
    case 'BANK_FEE': {
      const fee = await tx.bankFee.findFirst({
        where: { id: documentId, tenantId, organizationId },
      });
      return fee
        ? {
            bankAccountId: fee.bankAccountId,
            expectedAmount: new Decimal(fee.amount.toString())
              .plus(fee.taxAmount.toString())
              .neg(),
          }
        : null;
    }
    case 'INTERNAL_BANK_TRANSFER': {
      const transfer = await tx.internalBankTransfer.findFirst({
        where: { id: documentId, tenantId, organizationId },
      });
      if (!transfer) return null;
      // Ambiguous without knowing which leg's statement line this is —
      // caller narrows by the line's own bankAccountId first.
      return {
        bankAccountId: transfer.sourceBankAccountId,
        expectedAmount: new Decimal(transfer.amount.toString())
          .plus(transfer.feeAmount.toString())
          .neg(),
      };
    }
    case 'FX_CONVERSION': {
      const conversion = await tx.fXConversion.findFirst({
        where: { id: documentId, tenantId, organizationId },
      });
      if (!conversion) return null;
      return {
        bankAccountId: conversion.sourceBankAccountId,
        expectedAmount: new Decimal(conversion.sourceAmount.toString()).neg(),
      };
    }
    default:
      return null;
  }
}

/** InternalBankTransfer/FXConversion touch TWO bank accounts — this picks
 * whichever leg matches the statement line's own bank account (the
 * destination/inflow leg), falling back to the source leg resolveMatchCandidate
 * already covers. */
async function resolveTwoLegCandidate(
  tx: any,
  tenantId: string,
  organizationId: string,
  documentType: string,
  documentId: string,
  lineBankAccountId: string,
): Promise<{ bankAccountId: string; expectedAmount: Decimal } | null> {
  if (documentType === 'INTERNAL_BANK_TRANSFER') {
    const transfer = await tx.internalBankTransfer.findFirst({
      where: { id: documentId, tenantId, organizationId },
    });
    if (!transfer) return null;
    if (transfer.destinationBankAccountId === lineBankAccountId)
      return {
        bankAccountId: transfer.destinationBankAccountId,
        expectedAmount: new Decimal(transfer.amount.toString()),
      };
    return {
      bankAccountId: transfer.sourceBankAccountId,
      expectedAmount: new Decimal(transfer.amount.toString())
        .plus(transfer.feeAmount.toString())
        .neg(),
    };
  }
  if (documentType === 'FX_CONVERSION') {
    const conversion = await tx.fXConversion.findFirst({
      where: { id: documentId, tenantId, organizationId },
    });
    if (!conversion) return null;
    if (conversion.destinationBankAccountId === lineBankAccountId)
      return {
        bankAccountId: conversion.destinationBankAccountId,
        expectedAmount: new Decimal(conversion.destinationAmount.toString()),
      };
    return {
      bankAccountId: conversion.sourceBankAccountId,
      expectedAmount: new Decimal(conversion.sourceAmount.toString()).neg(),
    };
  }
  return resolveMatchCandidate(
    tx,
    tenantId,
    organizationId,
    documentType,
    documentId,
  );
}

/** Bank-operation-code / description pattern -> suggested classification
 * (spec section 122) — deterministic rules only (spec section 123's own
 * "AI boundary": Phase 14 is rules + score foundation, an ML suggestion
 * layer is Phase 29's job and must never bypass this rule engine). */
const FEE_DESCRIPTION_PATTERN =
  /\b(fee|commission|maintenance|xidmət haqqı|komisyon)\b/i;

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
    private readonly bankFees: BankFeeService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    bankAccountId?: string,
    status?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        ...(bankAccountId ? { bankAccountId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { statementDate: 'desc' },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateBankStatementLineDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });
    if (!bankAccount)
      throw new ValidationAppError(
        'Bank account does not belong to this organization',
      );

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

    await this.audit.record({
      tenantId,
      eventType: 'BANK_STATEMENT_LINE_CREATED',
      entityType: BANK_STATEMENT_LINE_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { amount: created.amount.toString() },
    });
    return created;
  }

  /**
   * Header-field edit, only while `status === 'UNMATCHED'` — once a line
   * is matched, editing it would let its amount silently drift from the
   * PaymentOrder.reconcile() call `match()` already made, so it's locked
   * the same way a posted document is locked elsewhere in this codebase.
   */
  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: UpdateBankStatementLineDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, organizationId },
    });
    if (!line) throw new NotFoundAppError('BankStatementLine', id);
    if (line.status === 'MATCHED')
      throw new ValidationAppError(
        'A matched statement line cannot be edited — unmatch is not supported, delete and re-enter if needed',
      );

    const result = await this.prisma.bankStatementLine.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        ...(dto.statementDate !== undefined
          ? { statementDate: this.parseDate(dto.statementDate) }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.amount !== undefined
          ? { amount: new Decimal(dto.amount.toString()) }
          : {}),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'BANK_STATEMENT_LINE_UPDATED',
      entityType: BANK_STATEMENT_LINE_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: dto,
    });
    return this.prisma.bankStatementLine.findFirst({ where: { id } });
  }

  /**
   * Matches a statement line to the document that cleared it — PaymentOrder
   * (outflow), IncomingBankPayment (inflow), BankFee (outflow),
   * InternalBankTransfer/FXConversion (either leg — spec section 39).
   * Amount must match exactly per that document type's own sign
   * convention — no fuzzy/tolerance matching, so a mismatch surfaces as a
   * clear validation error rather than a silently-wrong reconciliation.
   */
  async match(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: MatchBankStatementLineDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, organizationId },
    });
    if (!line) throw new NotFoundAppError('BankStatementLine', id);
    if (line.status === 'MATCHED')
      throw new ValidationAppError('This statement line is already matched');

    const candidate = await resolveTwoLegCandidate(
      this.prisma,
      tenantId,
      organizationId,
      dto.documentType,
      dto.documentId,
      line.bankAccountId,
    );
    if (!candidate)
      throw new ValidationAppError(
        `${dto.documentType} does not belong to this organization`,
      );
    if (candidate.bankAccountId !== line.bankAccountId)
      throw new ValidationAppError(
        "This document's bank account does not match this statement line's bank account",
      );

    if (dto.documentType === 'PAYMENT_ORDER') {
      const order = await this.prisma.paymentOrder.findFirst({
        where: { id: dto.documentId, organizationId },
      });
      if (order?.reconciled)
        throw new ValidationAppError(
          'This payment order is already reconciled',
        );
    }

    const lineAmount = new Decimal(line.amount.toString());
    if (!lineAmount.eq(candidate.expectedAmount)) {
      throw new ValidationAppError(
        `Amount mismatch: statement line is ${lineAmount.toString()}, expected ${candidate.expectedAmount.toString()} for this document`,
      );
    }

    // Concurrency safety (spec section 112, test 172): the advisory lock
    // must be held for the remainder of THIS transaction (pg_advisory_xact_lock
    // releases at commit) — acquiring it as a standalone $executeRaw call
    // would auto-commit and release it immediately, defeating the whole
    // point. Re-checks the line is still UNMATCHED after acquiring the
    // lock, since a concurrent request may have matched it between the
    // read above and the lock being granted.
    const updated = await this.prisma.runInTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${id}`}))`;
      const current = await tx.bankStatementLine.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw new NotFoundAppError('BankStatementLine', id);
      if (current.status === 'MATCHED')
        throw new ValidationAppError('This statement line is already matched');

      if (dto.documentType === 'PAYMENT_ORDER') {
        const order = await tx.paymentOrder.findFirst({
          where: { id: dto.documentId, organizationId },
        });
        if (order) {
          await tx.paymentOrder.updateMany({
            where: { id: order.id, organizationId, version: order.version },
            data: {
              reconciled: true,
              reconciledAt: new Date(),
              reconciledBy: userId,
              bankStatementAmount: lineAmount.neg(),
              reconciliationDifference: lineAmount
                .neg()
                .minus(order.amount.toString()),
              version: { increment: 1 },
            },
          });
          await this.audit.record(
            {
              tenantId,
              eventType: 'PAYMENT_ORDER_RECONCILED',
              entityType: 'PAYMENT_ORDER',
              entityId: order.id,
              action: 'UPDATE',
              userId,
              newValues: { bankStatementAmount: lineAmount.neg().toString() },
            },
            tx,
          );
        }
      }

      return tx.bankStatementLine.update({
        where: { id },
        data: {
          status: 'MATCHED',
          matchedDocumentType: dto.documentType,
          matchedDocumentId: dto.documentId,
          matchedAt: new Date(),
          matchedBy: userId,
          version: { increment: 1 },
        },
      });
    });

    await this.audit.record({
      tenantId,
      eventType: 'BANK_STATEMENT_LINE_MATCHED',
      entityType: BANK_STATEMENT_LINE_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: {
        matchedDocumentType: dto.documentType,
        matchedDocumentId: dto.documentId,
      },
    });
    return updated;
  }

  /** Unmatched-transaction classification workflow (spec sections 48, 55):
   * confirms a suggested BANK_FEE for a line with no matching ERP
   * document — creates the BankFee (still NOT_POSTED — post it through
   * the generic `/documents/BANK_FEE/:id/post` endpoint same as any other
   * document), then marks the line MATCHED against it. Never silently
   * ignored (spec: "Unknown transaction silent ignore edilməməlidir"). */
  async classifyAsBankFee(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: ClassifyAsBankFeeDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, organizationId },
    });
    if (!line) throw new NotFoundAppError('BankStatementLine', id);
    if (line.status === 'MATCHED')
      throw new ValidationAppError('This statement line is already matched');
    const lineAmount = new Decimal(line.amount.toString());
    if (lineAmount.gte(0))
      throw new ValidationAppError(
        'Only an outflow (negative amount) line can be classified as a bank fee',
      );

    await this.bankFees.ensureSequenceForFee(tenantId);
    const fee = await this.prisma.runInTransaction((tx) =>
      this.bankFees.createInTransaction(tx, tenantId, organizationId, userId, {
        documentDate: line.statementDate,
        bankAccountId: line.bankAccountId,
        feeType: dto.feeType ?? 'OTHER',
        currencyId: null,
        amount: lineAmount.neg(),
        taxAmount: new Decimal(0),
        description: line.description ?? undefined,
        sourceStatementLineId: line.id,
      }),
    );

    const updated = await this.prisma.bankStatementLine.update({
      where: { id },
      data: {
        status: 'MATCHED',
        matchedDocumentType: 'BANK_FEE',
        matchedDocumentId: fee.id,
        matchedAt: new Date(),
        matchedBy: userId,
        version: { increment: 1 },
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'BANK_STATEMENT_LINE_MATCHED',
      entityType: BANK_STATEMENT_LINE_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { matchedDocumentType: 'BANK_FEE', matchedDocumentId: fee.id },
    });
    return { line: updated, fee };
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
  async importCsv(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    bankAccountId: string,
    userId: string,
    csvText: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
    });
    if (!bankAccount)
      throw new ValidationAppError(
        'Bank account does not belong to this organization',
      );

    const rows = this.parseCsv(csvText);
    if (rows.length === 0)
      throw new ValidationAppError('CSV file has no data rows');

    const existing = await this.prisma.bankStatementLine.findMany({
      where: { bankAccountId },
    });
    const existingKeys = new Set(
      existing.map((l) =>
        this.dedupeKey(
          l.statementDate.toISOString().slice(0, 10),
          l.amount.toString(),
          l.reference ?? '',
          l.description ?? '',
        ),
      ),
    );

    const toCreate: {
      statementDate: Date;
      description?: string;
      reference?: string;
      amount: string;
    }[] = [];
    const errors: { row: number; message: string }[] = [];
    let skipped = 0;

    rows.forEach((row, index) => {
      try {
        const date = this.parseDate(row.date);
        const amount = new Decimal(row.amount);
        if (!amount.isFinite() || amount.isZero())
          throw new ValidationAppError('Amount must be a non-zero number');
        const key = this.dedupeKey(
          date.toISOString().slice(0, 10),
          amount.toString(),
          row.reference ?? '',
          row.description ?? '',
        );
        if (existingKeys.has(key)) {
          skipped += 1;
          return;
        }
        existingKeys.add(key); // dedupe within the same file too
        toCreate.push({
          statementDate: date,
          description: row.description,
          reference: row.reference,
          amount: amount.toString(),
        });
      } catch (err) {
        errors.push({
          row: index + 2,
          message: err instanceof Error ? err.message : 'Invalid row',
        }); // +2: 1-indexed + header row
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
          {
            tenantId,
            eventType: 'BANK_STATEMENT_IMPORTED',
            entityType: BANK_STATEMENT_LINE_TYPE,
            entityId: bankAccountId,
            action: 'CREATE',
            userId,
            newValues: {
              imported: rows.length,
              skipped,
              errors: errors.length,
            },
          },
          tx,
        );
      }
      return rows;
    });

    return { imported: created.length, skipped, errors, lines: created };
  }

  private dedupeKey(
    dateIso: string,
    amount: string,
    reference: string,
    description: string,
  ): string {
    return `${dateIso}|${amount}|${reference.trim().toLowerCase()}|${description.trim().toLowerCase()}`;
  }

  /** Minimal CSV parser (no external dependency) — handles double-quoted
   * fields containing commas/quotes (RFC 4180 `""` escaping), which is
   * as much as a bank-agnostic export format needs. Column order is read
   * from the header row so `date,amount,description,reference` and
   * `reference,date,description,amount` both work. */
  private parseCsv(text: string): {
    date: string;
    description?: string;
    reference?: string;
    amount: string;
  }[] {
    const splitLine = (line: string): string[] => {
      const fields: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            current += ch;
          }
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
      throw new ValidationAppError(
        'CSV header must include at least "date" and "amount" columns',
      );
    }

    return lines.slice(1).map((line) => {
      const fields = splitLine(line);
      return {
        date: fields[dateIdx] ?? '',
        amount: fields[amountIdx] ?? '',
        description:
          descriptionIdx >= 0 ? fields[descriptionIdx] || undefined : undefined,
        reference:
          referenceIdx >= 0 ? fields[referenceIdx] || undefined : undefined,
      };
    });
  }

  /** Auto-match suggestions (Bank çıxarışı idxalı) — every POSTED,
   * not-yet-matched candidate across every matchable document type on the
   * same bank account whose amount exactly clears the line (per that
   * type's own sign convention — see resolveMatchCandidate), nearest
   * statement date first. Same exact-match rule `match()` itself enforces
   * — this only surfaces candidates, it never matches for the user. A
   * line with no candidates but a fee-like description also gets a
   * `suggestedClassification: 'BANK_FEE'` hint (spec section 122). */
  async suggestMatches(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, organizationId },
    });
    if (!line) throw new NotFoundAppError('BankStatementLine', id);
    if (line.status === 'MATCHED')
      return { candidates: [], suggestedClassification: null };

    const lineAmount = new Decimal(line.amount.toString());
    const withDelta = (doc: any, documentType: string) => ({
      ...doc,
      documentType,
      dateDeltaDays: Math.abs(
        (doc.documentDate.getTime() - line.statementDate.getTime()) /
          86_400_000,
      ),
    });

    const [orders, incoming, fees] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where: {
          tenantId,
          organizationId,
          bankAccountId: line.bankAccountId,
          postingStatus: 'POSTED',
          reconciled: false,
          amount: lineAmount.neg().toString(),
        },
      }),
      lineAmount.gt(0)
        ? this.prisma.incomingBankPayment.findMany({
            where: {
              tenantId,
              organizationId,
              bankAccountId: line.bankAccountId,
              postingStatus: 'POSTED',
              amount: lineAmount.toString(),
            },
          })
        : Promise.resolve([]),
      lineAmount.lt(0)
        ? this.prisma.bankFee.findMany({
            where: {
              tenantId,
              organizationId,
              bankAccountId: line.bankAccountId,
              postingStatus: 'POSTED',
            },
          })
        : Promise.resolve([]),
    ]);

    const candidates = [
      ...orders.map((o) => withDelta(o, 'PAYMENT_ORDER')),
      ...incoming.map((p) => withDelta(p, 'INCOMING_BANK_PAYMENT')),
      ...fees
        .filter((f) =>
          new Decimal(f.amount.toString())
            .plus(f.taxAmount.toString())
            .eq(lineAmount.neg()),
        )
        .map((f) => withDelta(f, 'BANK_FEE')),
    ].sort((a, b) => a.dateDeltaDays - b.dateDeltaDays);

    const suggestedClassification =
      candidates.length === 0 &&
      lineAmount.lt(0) &&
      FEE_DESCRIPTION_PATTERN.test(line.description ?? '')
        ? 'BANK_FEE'
        : null;

    return { candidates, suggestedClassification };
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid statement date');
    return date;
  }
}
