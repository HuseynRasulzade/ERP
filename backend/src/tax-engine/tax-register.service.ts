import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { TaxPostingDuplicateError } from '../common/errors/app-error';
import { TaxLineResult } from './tax-calculation-result';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AuditService } from '../audit/audit.service';

export interface RegisterTaxableParams {
  organizationId: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  taxPointDate: Date;
  currencyId?: string;
  /** SALE -> output VAT liability; PURCHASE -> input VAT (recoverable/pending/non-recoverable). */
  operationType: 'SALE' | 'PURCHASE';
  lines: TaxLineResult[];
  /** True for a Sales/Purchase Return (Sales Execution spec section 51):
   * flips the GL side of the VAT line (a return DEBITS output VAT payable
   * instead of crediting it, reducing the liability) while the
   * `TaxMovement` row still records the same `direction` as the original
   * sale/purchase — a genuinely new tax event tagged by its own
   * `sourceDocumentType`, not a reversal of a specific prior movement.
   * `taxBalance()`'s reversal-based netting does not net these against
   * the original automatically; a period report must sum both source
   * types explicitly — see docs/SALES_EXECUTION.md. */
  contra?: boolean;
}

/**
 * TaxRegisterService — the Tax Register (spec sections 64-66). Writes only
 * `TaxMovement` rows; it never touches `AccountingMovement` (spec section
 * 5/114). Instead it returns the `AccountingPostingLineInput[]` a caller
 * merges into its OWN `AccountingPostingEngine.postBatch` call so Tax
 * Register + GL land in one atomic transaction (spec section 67) — pass
 * the same `tx` to both calls.
 */
@Injectable()
export class TaxRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly audit: AuditService,
  ) {}

  async registerTaxable(
    tenantId: string,
    userId: string,
    params: RegisterTaxableParams,
    tx?: PrismaTransactionClient,
  ): Promise<{ movementIds: string[]; accountingLines: AccountingPostingLineInput[] }> {
    const client = tx ?? this.prisma;

    if (params.sourceDocumentType && params.sourceDocumentId) {
      const existing = await client.taxMovement.findFirst({
        where: {
          tenantId,
          sourceDocumentType: params.sourceDocumentType,
          sourceDocumentId: params.sourceDocumentId,
          reversalOfMovementId: null,
        },
      });
      if (existing) throw new TaxPostingDuplicateError(params.sourceDocumentType, params.sourceDocumentId);
    }

    const reportingPeriod = `${params.taxPointDate.getUTCFullYear()}-${String(params.taxPointDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const direction = params.operationType === 'SALE' ? 'OUTPUT' : 'INPUT';

    const movementIds: string[] = [];
    const accountingLines: AccountingPostingLineInput[] = [];

    for (const line of params.lines) {
      const movement = await client.taxMovement.create({
        data: {
          tenantId,
          organizationId: params.organizationId,
          taxType: line.taxType,
          taxCode: line.taxCode,
          taxTreatment: line.treatment as any,
          sourceDocumentType: params.sourceDocumentType,
          sourceDocumentId: params.sourceDocumentId,
          sourceLineId: line.sourceLineId,
          taxPointDate: params.taxPointDate,
          reportingPeriod,
          taxableBase: line.taxableBase.toString(),
          taxAmount: line.taxAmount.toString(),
          recoverableAmount: line.recoverableAmount.toString(),
          nonrecoverableAmount: line.nonrecoverableAmount.toString(),
          currencyId: params.currencyId,
          direction,
          taxRuleId: line.ruleId,
          taxRateId: line.rateId,
        },
      });
      movementIds.push(movement.id);

      if (line.taxAmount.isZero()) continue; // ZERO_RATED/EXEMPT/OUT_OF_SCOPE still register, but generate no GL line

      if (direction === 'OUTPUT') {
        const account = await this.mappings.resolve(
          tenantId,
          params.organizationId,
          MappingKeys.VAT_OUTPUT_PAYABLE,
          params.taxPointDate,
          client,
        );
        accountingLines.push({
          accountId: account.id,
          side: params.contra ? 'DEBIT' : 'CREDIT',
          amountBase: line.taxAmount,
          description: `${line.taxType} output tax — ${line.explanation}`,
        });
      } else {
        if (!line.recoverableAmount.isZero()) {
          const account = await this.mappings.resolve(
            tenantId,
            params.organizationId,
            MappingKeys.VAT_INPUT_RECOVERABLE,
            params.taxPointDate,
            client,
          );
          accountingLines.push({
            accountId: account.id,
            side: params.contra ? 'CREDIT' : 'DEBIT',
            amountBase: line.recoverableAmount,
            description: `${line.taxType} recoverable input tax`,
          });
        }
        if (!line.nonrecoverableAmount.isZero()) {
          const account = await this.mappings.resolve(
            tenantId,
            params.organizationId,
            MappingKeys.VAT_INPUT_NONRECOVERABLE,
            params.taxPointDate,
            client,
          );
          accountingLines.push({
            accountId: account.id,
            side: params.contra ? 'CREDIT' : 'DEBIT',
            amountBase: line.nonrecoverableAmount,
            description: `${line.taxType} non-recoverable input tax`,
          });
        }
      }
    }

    await this.audit.record(
      {
        tenantId,
        eventType: 'TAX_CALCULATED',
        entityType: 'TaxMovement',
        entityId: params.sourceDocumentId ?? 'manual',
        action: 'CREATE',
        userId,
        newValues: { sourceDocumentType: params.sourceDocumentType, lineCount: params.lines.length },
      },
      client,
    );

    return { movementIds, accountingLines };
  }

  /**
   * Traceability (spec section 108: "summary -> TaxMovement -> Source
   * Document -> Journal Entry" is mandatory). Call after `postBatch` has
   * created the Journal Entry, passing the SAME `tx` so the link is part
   * of the same atomic write as the posting itself.
   */
  async linkJournalEntry(tenantId: string, movementIds: string[], journalEntryId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    await client.taxMovement.updateMany({
      where: { id: { in: movementIds }, tenantId },
      data: { journalEntryId },
    });
  }

  /**
   * Reversal (spec section 66/126) — mirrors AccountingPostingEngine's own
   * reversal semantics: a NEW row per original, never an edit of posted
   * history. `taxBalance` below nets a reversal row against its original
   * by subtracting it rather than the schema carrying a signed amount.
   */
  async reverseTaxable(
    tenantId: string,
    userId: string,
    sourceDocumentType: string,
    sourceDocumentId: string,
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const originals = await client.taxMovement.findMany({
      where: { tenantId, sourceDocumentType, sourceDocumentId, reversalOfMovementId: null },
    });

    const reversals = [];
    for (const original of originals) {
      const reversal = await client.taxMovement.create({
        data: {
          tenantId,
          organizationId: original.organizationId,
          taxType: original.taxType,
          taxCode: original.taxCode,
          taxTreatment: original.taxTreatment,
          sourceDocumentType: original.sourceDocumentType,
          sourceDocumentId: original.sourceDocumentId,
          sourceLineId: original.sourceLineId,
          taxPointDate: original.taxPointDate,
          reportingPeriod: original.reportingPeriod,
          taxableBase: original.taxableBase,
          taxAmount: original.taxAmount,
          recoverableAmount: original.recoverableAmount,
          nonrecoverableAmount: original.nonrecoverableAmount,
          currencyId: original.currencyId,
          direction: original.direction,
          taxRuleId: original.taxRuleId,
          taxRateId: original.taxRateId,
          reversalOfMovementId: original.id,
        },
      });
      reversals.push(reversal);
    }

    await this.audit.record(
      {
        tenantId,
        eventType: 'TAX_REVERSED',
        entityType: 'TaxMovement',
        entityId: sourceDocumentId,
        action: 'REVERSE',
        userId,
        newValues: { sourceDocumentType, reversedCount: reversals.length },
      },
      client,
    );

    return reversals;
  }

  async taxBalance(
    tenantId: string,
    organizationId: string,
    params: { fromDate: Date; toDate: Date; taxType?: string },
  ) {
    const movements = await this.prisma.taxMovement.findMany({
      where: {
        tenantId,
        organizationId,
        taxPointDate: { gte: params.fromDate, lte: params.toDate },
        ...(params.taxType ? { taxType: params.taxType } : {}),
      },
    });

    let taxableBase = new Decimal(0);
    let taxAmount = new Decimal(0);
    let recoverableAmount = new Decimal(0);
    let nonrecoverableAmount = new Decimal(0);
    for (const m of movements) {
      const sign = m.reversalOfMovementId ? -1 : 1;
      taxableBase = taxableBase.plus(new Decimal(m.taxableBase).mul(sign));
      taxAmount = taxAmount.plus(new Decimal(m.taxAmount).mul(sign));
      recoverableAmount = recoverableAmount.plus(new Decimal(m.recoverableAmount).mul(sign));
      nonrecoverableAmount = nonrecoverableAmount.plus(new Decimal(m.nonrecoverableAmount).mul(sign));
    }

    return {
      taxableBase: taxableBase.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      recoverableAmount: recoverableAmount.toFixed(2),
      nonrecoverableAmount: nonrecoverableAmount.toFixed(2),
      movementCount: movements.length,
    };
  }

  list(tenantId: string, organizationId: string, params: { fromDate: Date; toDate: Date }) {
    return this.prisma.taxMovement.findMany({
      where: { tenantId, organizationId, taxPointDate: { gte: params.fromDate, lte: params.toDate } },
      orderBy: [{ taxPointDate: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
