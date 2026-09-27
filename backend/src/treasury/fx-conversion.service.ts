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
import { CreateFXConversionDto } from './dto/treasury.dto';
import { FX_CONVERSION_TYPE } from './fx-conversion.repository';

const SEQUENCE_PREFIX = 'FXCONV';

/**
 * FX Conversion (spec sections 61-63) — a currency exchange between two of
 * the tenant's own bank accounts.
 */
@Injectable()
export class FXConversionService {
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
        this.prisma.fXConversion.findMany({
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
    const row = await this.prisma.fXConversion.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('FXConversion', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateFXConversionDto,
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
    if (source.currencyId !== dto.sourceCurrencyId)
      throw new ValidationAppError(
        "Source currency does not match the source bank account's own currency",
      );
    if (destination.currencyId !== dto.destinationCurrencyId)
      throw new ValidationAppError(
        "Destination currency does not match the destination bank account's own currency",
      );

    const sourceAmount = new Decimal(dto.sourceAmount.toString());
    const destinationAmount = new Decimal(dto.destinationAmount.toString());
    if (!sourceAmount.isFinite() || sourceAmount.lte(0))
      throw new ValidationAppError('Source amount must be positive');
    if (!destinationAmount.isFinite() || destinationAmount.lte(0))
      throw new ValidationAppError('Destination amount must be positive');
    const bankFee =
      dto.bankFee != null
        ? new Decimal(dto.bankFee.toString())
        : new Decimal(0);
    if (bankFee.isNegative())
      throw new ValidationAppError('Bank fee cannot be negative');

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        FX_CONVERSION_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.fXConversion.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          sourceBankAccountId: dto.sourceBankAccountId,
          destinationBankAccountId: dto.destinationBankAccountId,
          sourceCurrencyId: dto.sourceCurrencyId,
          sourceAmount,
          destinationCurrencyId: dto.destinationCurrencyId,
          destinationAmount,
          tradeRate: destinationAmount.div(sourceAmount),
          officialRate:
            dto.officialRate != null
              ? new Decimal(dto.officialRate.toString())
              : undefined,
          bankFee,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'FX_CONVERSION_CREATED',
          entityType: FX_CONVERSION_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: {
            number: created.number,
            sourceAmount: sourceAmount.toString(),
            destinationAmount: destinationAmount.toString(),
          },
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
      where: { tenantId_code: { tenantId, code: FX_CONVERSION_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: FX_CONVERSION_TYPE,
          documentType: FX_CONVERSION_TYPE,
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
