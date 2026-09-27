import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { CASH_COUNT_ADJUSTMENT_TYPE } from './cash-count-adjustment.repository';
import { CASH_MOVEMENT_REGISTER } from './cash-balance.service';
import { AccountablePersonService } from './accountable-person.service';

/**
 * Posting handler for CashCountAdjustment (docx spec Phase 15, "Physical
 * Count Difference Resolution") — the ONLY way a physical-count
 * difference ever reaches the book balance/GL: never a direct edit of the
 * cash register, always this document, always traceable back to the
 * CashPhysicalCount it resolves (`countId`, unique — one adjustment per
 * count).
 *
 * CASH_SURPLUS / DOCUMENT_CORRECTION with a positive difference: Dr Cash
 * / Cr CASH_SURPLUS_INCOME (611).
 * CASH_SHORTAGE / DOCUMENT_CORRECTION with a negative difference: Dr
 * CASH_SHORTAGE_LOSS (731) / Cr Cash.
 * CASHIER_RECEIVABLE: the shortage is charged to a named
 * ResponsiblePerson instead of expensed — Dr ACCOUNTABLE_PERSON_RECEIVABLE
 * (244, dim EMPLOYEE) / Cr Cash, and records an AccountablePersonMovement
 * so it ages alongside employee-advance receivables (spec section 59; no
 * payroll-deduction wiring here — that is a later phase's job, disclosed
 * in docs/CASH_DESK.md).
 * OTHER: posts to the generic OTHER_OPERATING_INCOME/EXPENSE accounts,
 * same as an unclassified CashTransaction.
 */
@Injectable()
export class CashCountAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = CASH_COUNT_ADJUSTMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly accountablePersons: AccountablePersonService,
  ) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const adjustment = await tx.cashCountAdjustment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!adjustment)
      throw new ValidationAppError('Document disappeared during posting');
    if (adjustment.amount.lte(0))
      throw new ValidationAppError(
        'Cannot post a cash count adjustment with a non-positive amount',
      );

    const cashbox = await tx.cashbox.findFirst({
      where: { id: adjustment.cashboxId, tenantId },
    });
    if (!cashbox || !cashbox.active)
      throw new ValidationAppError(
        'Cannot post an adjustment against a missing or inactive cashbox',
      );

    if (
      adjustment.adjustmentType === 'CASHIER_RECEIVABLE' &&
      !adjustment.responsiblePersonId
    ) {
      throw new ValidationAppError(
        'A CASHIER_RECEIVABLE adjustment requires a responsiblePersonId',
      );
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const adjustment = await tx.cashCountAdjustment.findFirst({
      where: { id: document.id, tenantId },
      include: { count: true },
    });
    if (!adjustment)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const isSurplus = new Decimal(
      adjustment.count.difference?.toString() ?? '0',
    ).gt(0);

    return [
      {
        registerCode: CASH_MOVEMENT_REGISTER,
        businessDate,
        movementType: 'CASH_COUNT_ADJUSTMENT',
        dimensions: {
          organizationId: adjustment.organizationId,
          cashboxId: adjustment.cashboxId,
        },
        resources: {
          amount: adjustment.amount.toString(),
          direction: isSurplus ? 'RECEIPT' : 'PAYMENT',
        },
      },
    ];
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const adjustment = await tx.cashCountAdjustment.findFirst({
      where: { id: document.id, tenantId },
      include: { count: true },
    });
    if (!adjustment)
      throw new ValidationAppError('Document disappeared during posting');
    const organizationId = adjustment.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(adjustment.amount.toString());
    const isSurplus = new Decimal(
      adjustment.count.difference?.toString() ?? '0',
    ).gt(0);

    const cashbox = await tx.cashbox.findFirst({
      where: { id: adjustment.cashboxId },
    });
    let currencyId = cashbox?.currencyId ?? null;
    if (!currencyId) {
      const org = await tx.organization.findUnique({
        where: { id: organizationId },
      });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId)
      throw new ValidationAppError(
        'Cannot post a cash count adjustment: no currency resolvable',
      );

    const cashAccount = await this.mappings.resolve(
      tenantId,
      organizationId,
      MappingKeys.CASH,
      businessDate,
      tx,
    );
    const cashDimensions = [
      { dimensionCode: 'CASHBOX', referenceId: adjustment.cashboxId },
      { dimensionCode: 'CURRENCY', referenceId: currencyId },
    ];

    let lines: AccountingPostingLineInput[];
    if (adjustment.adjustmentType === 'CASHIER_RECEIVABLE') {
      const receivableAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.ACCOUNTABLE_PERSON_RECEIVABLE,
        businessDate,
        tx,
      );
      const receivableDimensions = [
        {
          dimensionCode: 'EMPLOYEE',
          referenceId: adjustment.responsiblePersonId!,
        },
        { dimensionCode: 'CURRENCY', referenceId: currencyId },
      ];
      lines = [
        {
          accountId: receivableAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: `Cash count adjustment ${adjustment.number ?? adjustment.id} — charged to cashier`,
          dimensions: receivableDimensions,
        },
        {
          accountId: cashAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: `Cash count adjustment ${adjustment.number ?? adjustment.id} — shortage`,
          dimensions: cashDimensions,
        },
      ];

      await this.accountablePersons.recordMovement(
        tenantId,
        {
          organizationId,
          personId: adjustment.responsiblePersonId!,
          currencyId,
          movementType: 'ADVANCE_ISSUED',
          amount,
          sourceDocumentType: CASH_COUNT_ADJUSTMENT_TYPE,
          sourceDocumentId: adjustment.id,
          effectiveDate: businessDate,
          createdBy: document.postedBy ?? document.createdBy ?? undefined,
        },
        tx,
      );
    } else if (adjustment.adjustmentType === 'OTHER') {
      const contraKey = isSurplus
        ? MappingKeys.OTHER_OPERATING_INCOME
        : MappingKeys.OTHER_OPERATING_EXPENSE;
      const contraAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        contraKey,
        businessDate,
        tx,
      );
      lines = isSurplus
        ? [
            {
              accountId: cashAccount.id,
              side: 'DEBIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id} — surplus`,
              dimensions: cashDimensions,
            },
            {
              accountId: contraAccount.id,
              side: 'CREDIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id}`,
              dimensions: [],
            },
          ]
        : [
            {
              accountId: contraAccount.id,
              side: 'DEBIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id}`,
              dimensions: [],
            },
            {
              accountId: cashAccount.id,
              side: 'CREDIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id} — shortage`,
              dimensions: cashDimensions,
            },
          ];
    } else {
      // CASH_SURPLUS | CASH_SHORTAGE | DOCUMENT_CORRECTION
      const contraKey = isSurplus
        ? MappingKeys.CASH_SURPLUS_INCOME
        : MappingKeys.CASH_SHORTAGE_LOSS;
      const contraAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        contraKey,
        businessDate,
        tx,
      );
      lines = isSurplus
        ? [
            {
              accountId: cashAccount.id,
              side: 'DEBIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id} — surplus`,
              dimensions: cashDimensions,
            },
            {
              accountId: contraAccount.id,
              side: 'CREDIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id}`,
              dimensions: [],
            },
          ]
        : [
            {
              accountId: contraAccount.id,
              side: 'DEBIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id}`,
              dimensions: [],
            },
            {
              accountId: cashAccount.id,
              side: 'CREDIT',
              amountBase: amount,
              description: `Cash count adjustment ${adjustment.number ?? adjustment.id} — shortage`,
              dimensions: cashDimensions,
            },
          ];
    }

    return {
      description: `Cash count adjustment ${adjustment.number ?? adjustment.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }

  async undoSideEffects(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    await this.accountablePersons.reverseForDocument(
      tenantId,
      CASH_COUNT_ADJUSTMENT_TYPE,
      document.id,
      tx,
    );
  }
}
