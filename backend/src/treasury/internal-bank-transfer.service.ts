import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { CreateInternalBankTransferDto } from './dto/treasury.dto';
import { INTERNAL_BANK_TRANSFER_TYPE } from './internal-bank-transfer.repository';

const SEQUENCE_PREFIX = 'INTXFR';

/**
 * Internal Bank Transfer (spec sections 57-60) — moves money between two
 * of the tenant's own bank accounts.
 */
@Injectable()
export class InternalBankTransferService {
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
        this.prisma.internalBankTransfer.findMany({
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
    const row = await this.prisma.internalBankTransfer.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('InternalBankTransfer', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateInternalBankTransferDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    if (dto.sourceBankAccountId === dto.destinationBankAccountId)
      throw new ValidationAppError(
        'Source and destination bank accounts must be different',
      );
    const [source, destination] = await Promise.all([
      this.prisma.bankAccount.findFirst({
        where: { id: dto.sourceBankAccountId, organizationId },
      }),
      this.prisma.bankAccount.findFirst({
        where: { id: dto.destinationBankAccountId, organizationId },
      }),
    ]);
    if (!source || !source.active)
      throw new ValidationAppError(
        'Source bank account does not belong to this organization or is inactive',
      );
    if (!destination || !destination.active)
      throw new ValidationAppError(
        'Destination bank account does not belong to this organization or is inactive',
      );

    const amount = new Decimal(dto.amount.toString());
    if (!amount.isFinite() || amount.lte(0))
      throw new ValidationAppError('Amount must be positive');
    const feeAmount =
      dto.feeAmount != null
        ? new Decimal(dto.feeAmount.toString())
        : new Decimal(0);
    if (feeAmount.isNegative())
      throw new ValidationAppError('Fee amount cannot be negative');

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        INTERNAL_BANK_TRANSFER_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.internalBankTransfer.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          sourceBankAccountId: dto.sourceBankAccountId,
          destinationBankAccountId: dto.destinationBankAccountId,
          currencyId: source.currencyId,
          amount,
          feeAmount,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'INTERNAL_BANK_TRANSFER_CREATED',
          entityType: INTERNAL_BANK_TRANSFER_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { number: created.number, amount: amount.toString() },
        },
        tx,
      );
      return created;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: INTERNAL_BANK_TRANSFER_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: INTERNAL_BANK_TRANSFER_TYPE,
          documentType: INTERNAL_BANK_TRANSFER_TYPE,
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
