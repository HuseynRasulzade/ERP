import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CASH_COUNT_ADJUSTMENT_TYPE } from './cash-count-adjustment.repository';

const SEQUENCE_PREFIX = 'CCADJ';

/** CashCountAdjustmentService — turns a CashPhysicalCount difference (or
 * a standalone correction) into its own document (spec sections 53-54),
 * mirroring DebtAdjustmentService's own "always require a reason" shape. */
@Injectable()
export class CashCountAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, cashDeskId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.cashCountAdjustment.findMany({ where: { organizationId, cashDeskId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.cashCountAdjustment.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('CashCountAdjustment', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { cashDeskId: string; physicalCountId?: string; adjustmentType: string; reasonCode?: string; employeeId?: string; currencyId: string; amount: number; documentDate: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.adjustmentType === 'CASHIER_RECEIVABLE' && !dto.employeeId) throw new ValidationAppError('CASHIER_RECEIVABLE requires an employeeId');
    if (['DOCUMENT_CORRECTION', 'OTHER'].includes(dto.adjustmentType) && !dto.reasonCode) throw new ValidationAppError('A reason code is required for this adjustment type');
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, CASH_COUNT_ADJUSTMENT_TYPE, documentDate, tx);
      const row = await tx.cashCountAdjustment.create({
        data: {
          tenantId,
          organizationId,
          cashDeskId: dto.cashDeskId,
          physicalCountId: dto.physicalCountId,
          adjustmentType: dto.adjustmentType,
          reasonCode: dto.reasonCode,
          employeeId: dto.employeeId,
          currencyId: dto.currencyId,
          amount: dto.amount.toString(),
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'CASH_COUNT_ADJUSTMENT_CREATED', entityType: CASH_COUNT_ADJUSTMENT_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { adjustmentType: dto.adjustmentType, amount: dto.amount } }, tx);
      return row;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: CASH_COUNT_ADJUSTMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: CASH_COUNT_ADJUSTMENT_TYPE, documentType: CASH_COUNT_ADJUSTMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
