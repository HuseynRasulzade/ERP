import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { PeriodService } from '../period/period.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  AccountDimensionRequiredError,
  AccountInactiveError,
  AccountNotPostableError,
  ConcurrencyConflictError,
  JournalAlreadyPostedError,
  JournalNotBalancedError,
  JournalNotPostedError,
  NotFoundAppError,
  PostingDuplicateError,
  ReversalNotAllowedError,
  ValidationAppError,
} from '../common/errors/app-error';

const JOURNAL_SEQUENCE_CODE = 'JOURNAL_ENTRY';
const JOURNAL_SEQUENCE_PREFIX = 'JE';

export interface PostingLineDimensionInput {
  dimensionCode: string;
  referenceId: string;
  scalarValue?: string;
}

export interface AccountingPostingLineInput {
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  amountBase: Decimal.Value;
  transactionCurrencyId?: string;
  amountTransaction?: Decimal.Value;
  exchangeRate?: Decimal.Value;
  quantity?: Decimal.Value;
  quantityUnitId?: string;
  description?: string;
  sourceDocumentLineId?: string;
  dimensions?: PostingLineDimensionInput[];
}

export interface AccountingPostingBatch {
  organizationId: string;
  businessDate: Date;
  postingDate?: Date;
  description?: string;
  operationType?: string;
  generatedBy?: string;
  isManual?: boolean;
  isOpeningBalance?: boolean;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  lines: AccountingPostingLineInput[];
}

/**
 * AccountingPostingEngine (spec sections 37-38) — the single gateway that
 * turns a balanced set of debit/credit lines into a posted JournalEntry +
 * immutable AccountingMovement rows. Every accounting consequence in this
 * ERP, present or future, must flow through here — never a bespoke
 * `UPDATE account SET balance = ...` anywhere else in the codebase
 * (spec section 4).
 */
@Injectable()
export class AccountingPostingEngine {
  private readonly logger = new Logger('AccountingPostingEngine');

  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: PeriodService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------------------------------------------------------------------
  // Manual Operation flow (spec section 51): draft first, post separately.
  // ---------------------------------------------------------------------

  async createDraft(
    tenantId: string,
    organizationId: string,
    userId: string,
    input: { businessDate: Date; description?: string; lines: AccountingPostingLineInput[] },
  ) {
    this.assertShapeValid(input.lines);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, JOURNAL_SEQUENCE_CODE, input.businessDate, tx);

      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          organizationId,
          journalNumber: allocated.formatted,
          businessDate: input.businessDate,
          postingDate: input.businessDate,
          operationType: 'MANUAL',
          generatedBy: 'MANUAL_OPERATION',
          description: input.description,
          status: 'DRAFT',
          isManual: true,
          createdBy: userId,
        },
      });

      await this.writeLines(tx, tenantId, entry.id, input.lines);

      await this.audit.record(
        {
          tenantId,
          eventType: 'JOURNAL_ENTRY_CREATED',
          entityType: 'JournalEntry',
          entityId: entry.id,
          action: 'CREATE',
          userId,
          newValues: { journalNumber: entry.journalNumber, lineCount: input.lines.length },
        },
        tx,
      );

      return this.loadEntry(tx, tenantId, entry.id);
    });
  }

  async postDraft(
    tenantId: string,
    entryId: string,
    userId: string,
    expectedVersion: number,
    tx?: PrismaTransactionClient,
  ) {
    const run = async (tx: PrismaTransactionClient) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, tenantId },
        include: { lines: { include: { dimensions: true } } },
      });
      if (!entry) throw new NotFoundAppError('JournalEntry', entryId);
      if (entry.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (entry.status === 'POSTED') throw new JournalAlreadyPostedError(entryId);
      if (entry.status === 'REVERSED') {
        throw new ValidationAppError('A reversed Journal Entry cannot be posted again');
      }

      await this.periods.assertDateIsOpen(tenantId, entry.businessDate, entry.organizationId);
      await this.validateLinesForPosting(tx, tenantId, entry.lines, entry.businessDate);

      await this.createMovementsForLines(tx, {
        tenantId,
        organizationId: entry.organizationId,
        journalEntryId: entry.id,
        businessDate: entry.businessDate,
        sourceDocumentType: entry.sourceDocumentType,
        sourceDocumentId: entry.sourceDocumentId,
        lines: entry.lines,
      });

      const updated = await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'POSTED', postedAt: new Date(), postedBy: userId, version: { increment: 1 } },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'JOURNAL_ENTRY_POSTED',
          entityType: 'JournalEntry',
          entityId: entry.id,
          action: 'POST',
          userId,
          newValues: { journalNumber: entry.journalNumber },
        },
        tx,
      );

      return this.loadEntry(tx, tenantId, updated.id);
    };
    return tx ? run(tx) : this.prisma.runInTransaction(run);
  }

  /**
   * Unposting (spec section 47): only meaningful while the source is still
   * editable (manual operations here) — transactionally removes the
   * generated movements and returns the entry to DRAFT. Never simply flips
   * a `posted` flag.
   */
  async unpost(
    tenantId: string,
    entryId: string,
    userId: string,
    expectedVersion: number,
    tx?: PrismaTransactionClient,
  ) {
    const run = async (tx: PrismaTransactionClient) => {
      const entry = await tx.journalEntry.findFirst({ where: { id: entryId, tenantId } });
      if (!entry) throw new NotFoundAppError('JournalEntry', entryId);
      if (entry.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (entry.status !== 'POSTED') throw new JournalNotPostedError(entryId);

      await this.periods.assertDateIsOpen(tenantId, entry.businessDate, entry.organizationId);

      const deleted = await tx.accountingMovement.deleteMany({ where: { tenantId, journalEntryId: entry.id } });

      const updated = await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'DRAFT', postedAt: null, postedBy: null, version: { increment: 1 } },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'JOURNAL_ENTRY_UNPOSTED',
          entityType: 'JournalEntry',
          entityId: entry.id,
          action: 'UNPOST',
          userId,
          oldValues: { removedMovements: deleted.count },
        },
        tx,
      );

      return this.loadEntry(tx, tenantId, updated.id);
    };
    return tx ? run(tx) : this.prisma.runInTransaction(run);
  }

  /**
   * Reversal (spec sections 48-49): a NEW operation that neutralizes the
   * original while the original stays visible forever, marked REVERSED.
   * Distinct from unpost — safe to use even after the original's own
   * period has since closed, as long as the reversal itself lands in an
   * open period.
   */
  async reverse(
    tenantId: string,
    entryId: string,
    userId: string,
    expectedVersion: number,
    reversalBusinessDate?: Date,
    tx?: PrismaTransactionClient,
  ) {
    const run = async (tx: PrismaTransactionClient) => {
      const original = await tx.journalEntry.findFirst({
        where: { id: entryId, tenantId },
        include: { lines: { include: { dimensions: true } } },
      });
      if (!original) throw new NotFoundAppError('JournalEntry', entryId);
      if (original.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (original.status !== 'POSTED') {
        throw new ReversalNotAllowedError('Only a posted Journal Entry can be reversed');
      }

      const businessDate = reversalBusinessDate ?? original.businessDate;
      await this.periods.assertDateIsOpen(tenantId, businessDate, original.organizationId);

      await this.ensureSequence(tenantId);
      const allocated = await this.numbering.allocateNumber(tenantId, JOURNAL_SEQUENCE_CODE, businessDate, tx);

      const reversal = await tx.journalEntry.create({
        data: {
          tenantId,
          organizationId: original.organizationId,
          journalNumber: allocated.formatted,
          businessDate,
          postingDate: businessDate,
          sourceDocumentType: original.sourceDocumentType,
          sourceDocumentId: original.sourceDocumentId,
          operationType: 'REVERSAL',
          generatedBy: original.generatedBy,
          description: `Reversal of ${original.journalNumber}`,
          status: 'DRAFT',
          isManual: original.isManual,
          isReversal: true,
          reversalOfEntryId: original.id,
          createdBy: userId,
        },
      });

      const flippedLines: AccountingPostingLineInput[] = original.lines.map((line) => ({
        accountId: line.accountId,
        side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amountBase: line.amountBase,
        transactionCurrencyId: line.transactionCurrencyId ?? undefined,
        amountTransaction: line.amountTransaction ?? undefined,
        exchangeRate: line.exchangeRate ?? undefined,
        quantity: line.quantity ?? undefined,
        quantityUnitId: line.quantityUnitId ?? undefined,
        description: line.description ?? undefined,
        dimensions: line.dimensions.map((d) => ({
          dimensionCode: d.dimensionDefinitionId,
          referenceId: d.referenceId,
          scalarValue: d.scalarValue ?? undefined,
        })),
      }));
      // dimensions above key by definition id already (cloned straight from
      // the original line), so writeLines must accept a definition-id path
      // too — see writeLines' dual lookup below.
      await this.writeLines(tx, tenantId, reversal.id, flippedLines, true);

      const reversalWithLines = await tx.journalEntry.findUniqueOrThrow({
        where: { id: reversal.id },
        include: { lines: { include: { dimensions: true } } },
      });

      const originalMovements = await tx.accountingMovement.findMany({
        where: { journalEntryId: original.id },
        include: { dimensions: true },
      });

      await this.createMovementsForLines(
        tx,
        {
          tenantId,
          organizationId: original.organizationId,
          journalEntryId: reversal.id,
          businessDate,
          sourceDocumentType: original.sourceDocumentType,
          sourceDocumentId: original.sourceDocumentId,
          lines: reversalWithLines.lines,
        },
        // Link each reversal movement back to the original it neutralizes,
        // matched positionally (same line order, flipped side) — sections
        // 34/49 ("every reversal movement should point to the original").
        originalMovements,
      );

      await tx.journalEntry.update({
        where: { id: reversal.id },
        data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId, version: { increment: 1 } },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'JOURNAL_ENTRY_REVERSED',
          entityType: 'JournalEntry',
          entityId: original.id,
          action: 'REVERSE',
          userId,
          newValues: { reversalEntryId: reversal.id, reversalJournalNumber: reversal.journalNumber },
        },
        tx,
      );

      return this.loadEntry(tx, tenantId, reversal.id);
    };
    return tx ? run(tx) : this.prisma.runInTransaction(run);
  }

  // ---------------------------------------------------------------------
  // Direct batch posting — the entry point future system documents (Sales,
  // Purchase, ...) will call from inside their own posting transaction
  // (spec section 44: posting must happen inside the parent document's
  // transaction). Not yet wired to any document handler in this build.
  // ---------------------------------------------------------------------

  async postBatch(tenantId: string, userId: string, batch: AccountingPostingBatch, tx?: PrismaTransactionClient) {
    const run = async (client: PrismaTransactionClient) => {
      if (batch.sourceDocumentType && batch.sourceDocumentId) {
        const active = await client.journalEntry.findFirst({
          where: {
            tenantId,
            sourceDocumentType: batch.sourceDocumentType,
            sourceDocumentId: batch.sourceDocumentId,
            status: 'POSTED',
          },
        });
        if (active) throw new PostingDuplicateError(batch.sourceDocumentType, batch.sourceDocumentId);
      }

      this.assertShapeValid(batch.lines);
      await this.periods.assertDateIsOpen(tenantId, batch.businessDate, batch.organizationId);
      await this.ensureSequence(tenantId);
      const allocated = await this.numbering.allocateNumber(tenantId, JOURNAL_SEQUENCE_CODE, batch.businessDate, client);

      const entry = await client.journalEntry.create({
        data: {
          tenantId,
          organizationId: batch.organizationId,
          journalNumber: allocated.formatted,
          businessDate: batch.businessDate,
          postingDate: batch.postingDate ?? batch.businessDate,
          sourceDocumentType: batch.sourceDocumentType,
          sourceDocumentId: batch.sourceDocumentId,
          operationType: batch.operationType ?? (batch.isOpeningBalance ? 'OPENING_BALANCE' : 'SYSTEM_DOCUMENT'),
          generatedBy: batch.generatedBy ?? (batch.isOpeningBalance ? 'OPENING_BALANCE' : 'SYSTEM_DOCUMENT'),
          description: batch.description,
          status: 'DRAFT',
          isManual: batch.isManual ?? false,
          isOpeningBalance: batch.isOpeningBalance ?? false,
          createdBy: userId,
        },
      });

      await this.writeLines(client, tenantId, entry.id, batch.lines);
      const withLines = await client.journalEntry.findUniqueOrThrow({
        where: { id: entry.id },
        include: { lines: { include: { dimensions: true } } },
      });

      await this.validateLinesForPosting(client, tenantId, withLines.lines, batch.businessDate);
      await this.createMovementsForLines(client, {
        tenantId,
        organizationId: batch.organizationId,
        journalEntryId: entry.id,
        businessDate: batch.businessDate,
        sourceDocumentType: batch.sourceDocumentType,
        sourceDocumentId: batch.sourceDocumentId,
        lines: withLines.lines,
      });

      const updated = await client.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'JOURNAL_ENTRY_POSTED',
          entityType: 'JournalEntry',
          entityId: entry.id,
          action: 'POST',
          userId,
          newValues: { journalNumber: entry.journalNumber, sourceDocumentType: batch.sourceDocumentType, sourceDocumentId: batch.sourceDocumentId },
        },
        client,
      );

      return this.loadEntry(client, tenantId, updated.id);
    };

    if (tx) return run(tx);
    return this.prisma.runInTransaction(run);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private assertShapeValid(lines: AccountingPostingLineInput[]) {
    if (!lines || lines.length === 0) {
      throw new ValidationAppError('Journal Entry must have at least one line');
    }
    for (const line of lines) {
      const amount = new Decimal(line.amountBase);
      if (amount.lte(0)) {
        throw new ValidationAppError('Every journal line amount must be a positive number (section 97/98)');
      }
    }
  }

  private async writeLines(
    tx: PrismaTransactionClient,
    tenantId: string,
    journalEntryId: string,
    lines: AccountingPostingLineInput[],
    dimensionsKeyedByDefinitionId = false,
  ) {
    const dimensionDefs = await tx.accountingDimensionDefinition.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
    });
    const dimByCode = new Map(dimensionDefs.map((d) => [d.code, d]));
    const dimById = new Map(dimensionDefs.map((d) => [d.id, d]));

    for (const [i, line] of lines.entries()) {
      const created = await tx.journalEntryLine.create({
        data: {
          journalEntryId,
          sequence: i,
          accountId: line.accountId,
          side: line.side,
          amountBase: new Decimal(line.amountBase).toString(),
          transactionCurrencyId: line.transactionCurrencyId,
          amountTransaction: line.amountTransaction !== undefined ? new Decimal(line.amountTransaction).toString() : undefined,
          exchangeRate: line.exchangeRate !== undefined ? new Decimal(line.exchangeRate).toString() : undefined,
          quantity: line.quantity !== undefined ? new Decimal(line.quantity).toString() : undefined,
          quantityUnitId: line.quantityUnitId,
          description: line.description,
          sourceDocumentLineId: line.sourceDocumentLineId,
        },
      });

      for (const dim of line.dimensions ?? []) {
        const def = dimensionsKeyedByDefinitionId ? dimById.get(dim.dimensionCode) : dimByCode.get(dim.dimensionCode);
        if (!def) throw new ValidationAppError(`Unknown accounting dimension: ${dim.dimensionCode}`);
        await tx.journalLineDimension.create({
          data: {
            journalLineId: created.id,
            dimensionDefinitionId: def.id,
            referenceType: def.referenceEntityType ?? def.code,
            referenceId: dim.referenceId,
            scalarValue: dim.scalarValue,
          },
        });
      }
    }
  }

  private async validateLinesForPosting(
    tx: PrismaTransactionClient,
    tenantId: string,
    lines: Array<{
      id: string;
      accountId: string;
      side: string;
      amountBase: Decimal;
      dimensions: Array<{ dimensionDefinitionId: string; referenceId: string }>;
    }>,
    businessDate: Date,
  ) {
    let debitTotal = new Decimal(0);
    let creditTotal = new Decimal(0);

    for (const line of lines) {
      const account = await tx.account.findFirst({ where: { id: line.accountId, tenantId } });
      if (!account) throw new NotFoundAppError('Account', line.accountId);
      if (!account.active) throw new AccountInactiveError(account.code);
      if (!account.postingAllowed) throw new AccountNotPostableError(account.code);

      const rules = await tx.accountDimensionRule.findMany({
        where: {
          accountId: account.id,
          active: true,
          required: true,
          validFrom: { lte: businessDate },
          OR: [{ validTo: null }, { validTo: { gte: businessDate } }],
        },
      });
      for (const rule of rules) {
        const has = line.dimensions.some((d) => d.dimensionDefinitionId === rule.dimensionDefinitionId);
        if (!has) {
          const def = await tx.accountingDimensionDefinition.findUnique({ where: { id: rule.dimensionDefinitionId } });
          throw new AccountDimensionRequiredError(account.code, def?.code ?? rule.dimensionDefinitionId);
        }
      }

      if (line.side === 'DEBIT') debitTotal = debitTotal.add(line.amountBase);
      else creditTotal = creditTotal.add(line.amountBase);
    }

    if (!debitTotal.equals(creditTotal)) {
      throw new JournalNotBalancedError(debitTotal.toFixed(4), creditTotal.toFixed(4));
    }
  }

  private async createMovementsForLines(
    tx: PrismaTransactionClient,
    params: {
      tenantId: string;
      organizationId: string;
      journalEntryId: string;
      businessDate: Date;
      sourceDocumentType?: string | null;
      sourceDocumentId?: string | null;
      lines: Array<{
        id: string;
        accountId: string;
        side: string;
        amountBase: Decimal;
        transactionCurrencyId: string | null;
        amountTransaction: Decimal | null;
        exchangeRate: Decimal | null;
        quantity: Decimal | null;
        quantityUnitId: string | null;
        sourceDocumentLineId: string | null;
        dimensions: Array<{ dimensionDefinitionId: string; referenceType: string; referenceId: string; scalarValue: string | null }>;
      }>;
    },
    // Positional original movements, when this call is building a reversal
    // (spec section 49: "every reversal line/movement should point to the
    // original where feasible").
    reversalOfMovements?: Array<{ id: string }>,
  ) {
    for (const [i, line] of params.lines.entries()) {
      const movement = await tx.accountingMovement.create({
        data: {
          tenantId: params.tenantId,
          organizationId: params.organizationId,
          journalEntryId: params.journalEntryId,
          journalLineId: line.id,
          sourceDocumentType: params.sourceDocumentType ?? undefined,
          sourceDocumentId: params.sourceDocumentId ?? undefined,
          sourceDocumentLineId: line.sourceDocumentLineId ?? undefined,
          accountId: line.accountId,
          side: line.side as 'DEBIT' | 'CREDIT',
          businessDate: params.businessDate,
          amountBase: line.amountBase,
          transactionCurrencyId: line.transactionCurrencyId ?? undefined,
          amountTransaction: line.amountTransaction ?? undefined,
          exchangeRate: line.exchangeRate ?? undefined,
          quantity: line.quantity ?? undefined,
          quantityUnitId: line.quantityUnitId ?? undefined,
          reversalOfMovementId: reversalOfMovements?.[i]?.id,
        },
      });

      for (const dim of line.dimensions) {
        await tx.accountingMovementDimension.create({
          data: {
            accountingMovementId: movement.id,
            dimensionDefinitionId: dim.dimensionDefinitionId,
            referenceType: dim.referenceType,
            referenceId: dim.referenceId,
            scalarValue: dim.scalarValue,
          },
        });
      }
    }
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: JOURNAL_SEQUENCE_CODE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: JOURNAL_SEQUENCE_CODE,
          documentType: JOURNAL_SEQUENCE_CODE,
          prefix: JOURNAL_SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race to create it concurrently — fine, it exists now.
    }
  }

  private loadEntry(tx: PrismaTransactionClient, tenantId: string, id: string) {
    return tx.journalEntry.findFirst({
      where: { id, tenantId },
      include: { lines: { include: { dimensions: true }, orderBy: { sequence: 'asc' } } },
    });
  }
}
