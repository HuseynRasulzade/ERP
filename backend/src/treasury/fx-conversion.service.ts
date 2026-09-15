import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { FX_CONVERSION_TYPE } from './fx-conversion.repository';

const SEQUENCE_PREFIX = 'FX';

@Injectable()
export class FXConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { sourceBankAccountId: string; destinationBankAccountId: string; sourceCurrencyId: string; sourceAmount: number; destinationCurrencyId: string; destinationAmount: number; tradeRate: number; officialRate?: number; bankFeeAmount?: number; bankReference?: string; conversionDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const conversionDate = this.parseDate(dto.conversionDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, FX_CONVERSION_TYPE, conversionDate, tx);
      const row = await tx.fXConversion.create({
        data: { tenantId, organizationId, sourceBankAccountId: dto.sourceBankAccountId, destinationBankAccountId: dto.destinationBankAccountId, sourceCurrencyId: dto.sourceCurrencyId, sourceAmount: dto.sourceAmount.toString(), destinationCurrencyId: dto.destinationCurrencyId, destinationAmount: dto.destinationAmount.toString(), tradeRate: dto.tradeRate.toString(), officialRate: dto.officialRate?.toString(), bankFeeAmount: (dto.bankFeeAmount ?? 0).toString(), bankReference: dto.bankReference, number: allocated.formatted, conversionDate, createdBy: userId, updatedBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'FX_CONVERSION_POSTED', entityType: FX_CONVERSION_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { sourceAmount: dto.sourceAmount, destinationAmount: dto.destinationAmount } }, tx);
      return row;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid conversion date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: FX_CONVERSION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: FX_CONVERSION_TYPE, documentType: FX_CONVERSION_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
