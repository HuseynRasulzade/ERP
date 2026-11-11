import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
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

type BankStatementFormat = 'CSV' | 'MT940' | 'CAMT053';

/** The common shape every format-specific parser below maps its own raw
 * fields into — the ONE internal line shape the rest of this import
 * pipeline (dedupe, create, audit) already operates on, regardless of
 * which file format produced it (spec section 36: CSV/MT940/CAMT.053 are
 * all acceptable input formats for the same statement line concept).
 * `date`/`amount` are left as unvalidated raw strings on purpose — the
 * existing per-row loop below is what parses and validates them (the
 * same two calls it already made for CSV), so a structurally-broken
 * entry in ANY format surfaces as the exact same kind of per-row
 * validation error instead of a second, format-specific error path.
 * `rowLabel` is only for that error message: CSV uses the file's own
 * line number (matching its pre-existing behaviour), MT940/CAMT.053 use
 * the 1-based position of the statement line/entry within the file. */
interface ParsedStatementRow {
  date: string;
  description?: string;
  reference?: string;
  amount: string;
  rowLabel: number;
}

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
 * link on the line's own side. File import (CSV, MT940, CAMT.053 — see
 * importStatement()) is one more way lines land in the same table; a
 * line entered by hand through create() is otherwise indistinguishable
 * from one read off a bank file.
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
   * Bank statement file import (Bank çıxarışı idxalı) — supports three
   * formats, each parsed into the exact same `ParsedStatementRow` shape
   * and then run through the ONE dedupe/create pipeline below: a plain,
   * bank-agnostic CSV (a header row naming `date,description,reference,
   * amount` in any order/case), MT940 (SWIFT customer statement message,
   * field-tag based), and CAMT.053 (ISO 20022 XML bank-to-customer
   * statement, `<Ntry>` entries). The caller states `format` explicitly
   * (no auto-sniffing — spec section 36 treats these as distinct
   * acceptable formats, not variants to guess between). Rows whose
   * (date, amount, reference, description) tuple already exists for this
   * bank account are skipped as likely re-imports of the same file,
   * rather than silently duplicated — the summary reports exactly which
   * rows landed where so the user can fix and re-upload just the rest.
   */
  async importStatement(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    bankAccountId: string,
    format: BankStatementFormat,
    userId: string,
    fileText: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
    });
    if (!bankAccount)
      throw new ValidationAppError(
        'Bank account does not belong to this organization',
      );

    const rows = this.parseStatementFile(format, fileText);
    if (rows.length === 0)
      throw new ValidationAppError(`${format} file has no data rows`);

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

    rows.forEach((row) => {
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
          row: row.rowLabel,
          message: err instanceof Error ? err.message : 'Invalid row',
        });
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
              format,
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

  /** Dispatches to the format-specific parser the caller named. Each one
   * returns the same `ParsedStatementRow[]` shape — date/amount are left
   * as raw strings for the shared per-row loop above to validate, so a
   * structurally-broken entry in any format surfaces as an ordinary
   * per-row import error instead of a crash. */
  private parseStatementFile(
    format: BankStatementFormat,
    text: string,
  ): ParsedStatementRow[] {
    switch (format) {
      case 'CSV':
        return this.parseCsv(text);
      case 'MT940':
        return this.parseMt940(text);
      case 'CAMT053':
        return this.parseCamt053(text);
      default:
        throw new ValidationAppError(
          `Unsupported bank statement format: ${format}`,
        );
    }
  }

  /** Minimal CSV parser (no external dependency) — handles double-quoted
   * fields containing commas/quotes (RFC 4180 `""` escaping), which is
   * as much as a bank-agnostic export format needs. Column order is read
   * from the header row so `date,amount,description,reference` and
   * `reference,date,description,amount` both work. */
  private parseCsv(text: string): ParsedStatementRow[] {
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

    return lines.slice(1).map((line, index) => {
      const fields = splitLine(line);
      return {
        date: fields[dateIdx] ?? '',
        amount: fields[amountIdx] ?? '',
        description:
          descriptionIdx >= 0 ? fields[descriptionIdx] || undefined : undefined,
        reference:
          referenceIdx >= 0 ? fields[referenceIdx] || undefined : undefined,
        rowLabel: index + 2, // +2: 1-indexed + header row, matching this format's pre-existing error numbering
      };
    });
  }

  /** `:61:` statement-line field pattern (SWIFT MT940, field 61):
   *   6!n        value date, YYMMDD
   *   [4!n]      entry date, MMDD (optional, rarely present — unused here)
   *   2a         debit/credit mark: D, C, RD (reversal debit) or RC
   *   15d        amount, SWIFT comma-decimal (e.g. "1500,00")
   *   1!a3!c     transaction type code (e.g. "NTRF") — optional, discarded
   *   16x[//16x] customer reference, optionally followed by a bank
   *              reference after "//" — this build assumes a transaction
   *              type code is present (as the SWIFT examples it was built
   *              against always carry one) and does not try to
   *              disambiguate a reference from one that omits it. */
  private static readonly MT940_LINE_61_PATTERN =
    /^(\d{6})(?:\d{4})?(R?[CD])(\d+,\d{0,2})(?:[A-Z][A-Z0-9]{3})?(.*)$/;

  /** MT940 (SWIFT customer statement message, spec section 36) — a
   * fixed-format field-tag text structure, not a delimited table. `:20:`
   * is the mandatory transaction reference every real MT940 message
   * carries, so its absence is treated as "not an MT940 file at all"
   * rather than a per-row error. Each `:61:` (statement line) is paired
   * with the `:86:` (information to account owner) that immediately
   * follows it for the line's narrative — multiple `:61:`/`:86:` pairs
   * per statement are walked in order. A line that spans more than one
   * physical line (continuation lines not starting with a new `:tag:`)
   * is joined back together before field-61 parsing, which is how a
   * multi-line `:86:` narrative is captured whole. */
  private parseMt940(text: string): ParsedStatementRow[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0 && l !== '-');

    const tagPattern = /^:([0-9]{2}[A-Z]?):(.*)$/;
    const tags: { tag: string; value: string }[] = [];
    for (const line of lines) {
      const match = line.match(tagPattern);
      if (match) {
        tags.push({ tag: match[1], value: match[2] });
      } else if (tags.length > 0) {
        // Continuation of the previous tag's value (e.g. a second line
        // of :86: narrative) — joined with a space, not a newline, since
        // :86: subfields are free text either way.
        tags[tags.length - 1].value += ` ${line.trim()}`;
      }
      // A stray line before any tag (e.g. a SWIFT block-1/block-2
      // envelope header some exports still include) is not a field this
      // import cares about — ignored rather than rejected.
    }

    if (!tags.some((t) => t.tag === '20'))
      throw new ValidationAppError(
        'MT940 file is missing the mandatory :20: transaction reference field — not a recognizable MT940 message',
      );

    const rows: ParsedStatementRow[] = [];
    let rowLabel = 0;
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].tag !== '61') continue;
      rowLabel += 1;
      const narrative =
        tags[i + 1]?.tag === '86' ? tags[i + 1].value.trim() : undefined;
      rows.push(
        this.parseMt940StatementLine(tags[i].value, narrative, rowLabel),
      );
    }

    if (rows.length === 0)
      throw new ValidationAppError(
        'MT940 file has no :61: statement line fields',
      );

    return rows;
  }

  private parseMt940StatementLine(
    raw: string,
    narrative: string | undefined,
    rowLabel: number,
  ): ParsedStatementRow {
    const match = raw.match(
      BankReconciliationService.MT940_LINE_61_PATTERN,
    );
    if (!match) {
      // Left deliberately empty rather than thrown here — the shared
      // per-row loop's own date/amount validation is what turns this
      // into a reported error, the same path a bad CSV row takes.
      return { date: '', amount: '', description: narrative, rowLabel };
    }
    const [, valueDate, mark, amountText, rest] = match;
    const date = `20${valueDate.slice(0, 2)}-${valueDate.slice(2, 4)}-${valueDate.slice(4, 6)}`;
    const isDebit = mark.endsWith('D');
    const amount = `${isDebit ? '-' : ''}${amountText.replace(',', '.')}`;
    const [customerRef, bankRef] = rest.split('//');
    const reference =
      (customerRef && customerRef.trim()) ||
      (bankRef && bankRef.trim()) ||
      undefined;
    return { date, amount, description: narrative, reference, rowLabel };
  }

  /** CAMT.053 (ISO 20022 XML bank-to-customer statement, spec section
   * 36) — one `<Ntry>` per statement entry under
   * `Document/BkToCstmrStmt/Stmt`. `<Amt>` is always a positive magnitude
   * in this message; `<CdtDbtInd>` (CRDT/DBIT) is what decides the sign
   * applied here, matching this import's own positive-inflow/
   * negative-outflow convention. Narrative is taken from
   * `<AddtlNtryInf>` plus any `<RmtInf><Ustrd>` text inside the entry's
   * own `<NtryDtls><TxDtls>` — both are included when both are present,
   * joined with " / ", since a bank may put different information in
   * each. */
  private parseCamt053(xmlText: string): ParsedStatementRow[] {
    const validation = XMLValidator.validate(xmlText);
    if (validation !== true)
      throw new ValidationAppError(
        `CAMT.053 file is not well-formed XML: ${validation.err.msg}`,
      );

    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      trimValues: true,
      isArray: (name) => ['Stmt', 'Ntry', 'TxDtls'].includes(name),
    });
    const doc = parser.parse(xmlText);
    const stmts = doc?.Document?.BkToCstmrStmt?.Stmt;
    if (!Array.isArray(stmts) || stmts.length === 0)
      throw new ValidationAppError(
        'CAMT.053 file is missing Document/BkToCstmrStmt/Stmt — not a recognizable camt.053 bank statement message',
      );

    const entries: unknown[] = stmts.flatMap((s: Record<string, unknown>) =>
      Array.isArray(s.Ntry) ? s.Ntry : [],
    );
    if (entries.length === 0)
      throw new ValidationAppError(
        'CAMT.053 file has no <Ntry> (statement entry) elements',
      );

    return entries.map((entry, index) =>
      this.parseCamt053Entry(entry as Record<string, unknown>, index + 1),
    );
  }

  private parseCamt053Entry(
    entry: Record<string, unknown>,
    rowLabel: number,
  ): ParsedStatementRow {
    const text = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;

    const indicator = text(entry.CdtDbtInd)?.toUpperCase();
    const amountText = text(entry.Amt) ?? '';
    const amount = indicator === 'DBIT' ? `-${amountText}` : amountText;

    const bookgDt = entry.BookgDt as Record<string, unknown> | undefined;
    const valDt = entry.ValDt as Record<string, unknown> | undefined;
    const date =
      text(bookgDt?.Dt) ??
      text(bookgDt?.DtTm)?.slice(0, 10) ??
      text(valDt?.Dt) ??
      text(valDt?.DtTm)?.slice(0, 10) ??
      '';

    const reference = text(entry.AcctSvcrRef) ?? text(entry.NtryRef);

    const narrativeParts: string[] = [];
    const additionalInfo = text(entry.AddtlNtryInf);
    if (additionalInfo) narrativeParts.push(additionalInfo);
    const ntryDtls = entry.NtryDtls as Record<string, unknown> | undefined;
    const txDtlsList = Array.isArray(ntryDtls?.TxDtls)
      ? (ntryDtls!.TxDtls as Record<string, unknown>[])
      : [];
    for (const tx of txDtlsList) {
      const rmtInf = tx.RmtInf as Record<string, unknown> | undefined;
      const ustrd = text(rmtInf?.Ustrd);
      if (ustrd) narrativeParts.push(ustrd);
    }

    return {
      date,
      amount,
      description:
        narrativeParts.length > 0 ? narrativeParts.join(' / ') : undefined,
      reference,
      rowLabel,
    };
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
