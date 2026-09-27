import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { CreateBankFeeDto } from './dto/treasury.dto';
import { BANK_FEE_TYPE } from './bank-fee.repository';

const SEQUENCE_PREFIX = 'BFEE';

/**
 * Bank Fee (spec section 54) — a bank charge/commission posted straight
 * to expense.
 */
@Injectable()
export class BankFeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.bankFee.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.bankFee.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('BankFee', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateBankFeeDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });
    if (!bankAccount || !bankAccount.active)
      throw new ValidationAppError(
        'Bank account does not belong to this organization or is inactive',
      );

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction((tx) =>
      this.createInTransaction(tx, tenantId, organizationId, userId, {
        documentDate: this.parseDate(dto.documentDate),
        bankAccountId: dto.bankAccountId,
        feeType: dto.feeType ?? 'OTHER',
        currencyId: dto.currencyId ?? bankAccount.currencyId,
        amount: new Decimal(dto.amount.toString()),
        taxAmount:
          dto.taxAmount != null
            ? new Decimal(dto.taxAmount.toString())
            : new Decimal(0),
        description: dto.description,
        sourceStatementLineId: undefined,
      }),
    );
  }

  /** Public so BankReconciliationService can ensure the sequence exists
   * before opening its own transaction (createInTransaction below assumes
   * it already does, same as every other document's ensureSequence). */
  async ensureSequenceForFee(tenantId: string) {
    await this.ensureSequence(tenantId);
  }

  /** Confirms an unmatched statement line's BANK_FEE classification
   * suggestion (spec sections 48, 55) — same transaction as marking the
   * line MATCHED, called by BankReconciliationService. */
  async createInTransaction(
    tx: PrismaTransactionClient,
    tenantId: string,
    organizationId: string,
    userId: string,
    input: {
      documentDate: Date;
      bankAccountId: string;
      feeType: string;
      currencyId: string | null;
      amount: Decimal;
      taxAmount: Decimal;
      description?: string;
      sourceStatementLineId?: string;
    },
  ) {
    if (!input.amount.isFinite() || input.amount.lte(0))
      throw new ValidationAppError('Amount must be positive');
    if (input.taxAmount.isNegative())
      throw new ValidationAppError('Tax amount cannot be negative');

    const allocated = await this.numbering.allocateNumber(
      tenantId,
      BANK_FEE_TYPE,
      input.documentDate,
      tx,
    );
    const created = await tx.bankFee.create({
      data: {
        tenantId,
        organizationId,
        number: allocated.formatted,
        documentDate: input.documentDate,
        bankAccountId: input.bankAccountId,
        feeType: input.feeType,
        currencyId: input.currencyId,
        amount: input.amount,
        taxAmount: input.taxAmount,
        description: input.description,
        sourceStatementLineId: input.sourceStatementLineId,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record(
      {
        tenantId,
        eventType: 'BANK_FEE_CREATED',
        entityType: BANK_FEE_TYPE,
        entityId: created.id,
        action: 'CREATE',
        userId,
        newValues: {
          number: created.number,
          amount: created.amount.toString(),
        },
      },
      tx,
    );
    return created;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: BANK_FEE_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: BANK_FEE_TYPE,
          documentType: BANK_FEE_TYPE,
          prefix: SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
