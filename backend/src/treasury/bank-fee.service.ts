import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { BANK_FEE_TYPE } from './bank-fee.repository';

const SEQUENCE_PREFIX = 'BFEE';

@Injectable()
export class BankFeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { bankAccountId: string; feeType?: string; currencyId: string; amount: number; taxAmount?: number; statementLineId?: string; feeDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const feeDate = this.parseDate(dto.feeDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, BANK_FEE_TYPE, feeDate, tx);
      const row = await tx.bankFee.create({
        data: { tenantId, organizationId, bankAccountId: dto.bankAccountId, feeType: dto.feeType ?? 'OTHER', currencyId: dto.currencyId, amount: dto.amount.toString(), taxAmount: (dto.taxAmount ?? 0).toString(), statementLineId: dto.statementLineId, feeDate, number: allocated.formatted, createdBy: userId, updatedBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'BANK_FEE_DETECTED', entityType: BANK_FEE_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { amount: dto.amount, feeType: dto.feeType } }, tx);
      return row;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid fee date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: BANK_FEE_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: BANK_FEE_TYPE, documentType: BANK_FEE_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
