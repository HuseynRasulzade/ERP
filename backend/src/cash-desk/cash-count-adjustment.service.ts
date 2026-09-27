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
import { CASH_COUNT_ADJUSTMENT_TYPE } from './cash-count-adjustment.repository';
import { CreateCashCountAdjustmentDto } from './dto/cash-desk.dto';

const SEQUENCE_PREFIX = 'CCA';

/**
 * CashCountAdjustment — created FROM an APPROVED CashPhysicalCount that
 * has a non-zero difference (docx spec Phase 15: a physical-count
 * difference must be resolved through a real document, never a silent
 * edit). One adjustment per count (`countId` unique) — the count row
 * itself is never touched again once this document exists.
 */
@Injectable()
export class CashCountAdjustmentService {
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
        this.prisma.cashCountAdjustment.findMany({
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
    const row = await this.prisma.cashCountAdjustment.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('CashCountAdjustment', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateCashCountAdjustmentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const count = await this.prisma.cashPhysicalCount.findFirst({
      where: { id: dto.countId, organizationId },
    });
    if (!count)
      throw new ValidationAppError(
        'Physical count does not belong to this organization',
      );
    if (count.status !== 'APPROVED')
      throw new ValidationAppError(
        'Only an APPROVED physical count can have an adjustment created for it',
      );
    const existing = await this.prisma.cashCountAdjustment.findUnique({
      where: { countId: dto.countId },
    });
    if (existing)
      throw new ValidationAppError(
        'This physical count already has an adjustment',
      );

    const difference = new Decimal(count.difference?.toString() ?? '0');
    if (difference.isZero())
      throw new ValidationAppError(
        'This physical count has no difference to adjust',
      );

    if (dto.adjustmentType === 'CASH_SURPLUS' && difference.lte(0))
      throw new ValidationAppError(
        'CASH_SURPLUS requires a positive count difference',
      );
    if (
      (dto.adjustmentType === 'CASH_SHORTAGE' ||
        dto.adjustmentType === 'CASHIER_RECEIVABLE') &&
      difference.gte(0)
    ) {
      throw new ValidationAppError(
        `${dto.adjustmentType} requires a negative count difference`,
      );
    }
    if (dto.adjustmentType === 'CASHIER_RECEIVABLE') {
      if (!dto.responsiblePersonId)
        throw new ValidationAppError(
          'CASHIER_RECEIVABLE requires a responsiblePersonId',
        );
      const person = await this.prisma.responsiblePerson.findFirst({
        where: { id: dto.responsiblePersonId, tenantId },
      });
      if (!person)
        throw new ValidationAppError(
          'Responsible person does not belong to this tenant',
        );
    }

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        CASH_COUNT_ADJUSTMENT_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.cashCountAdjustment.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          cashboxId: count.cashboxId,
          countId: dto.countId,
          adjustmentType: dto.adjustmentType,
          amount: difference.abs(),
          reasonCode: dto.reasonCode,
          responsiblePersonId: dto.responsiblePersonId,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'CASH_COUNT_ADJUSTMENT_CREATED',
          entityType: CASH_COUNT_ADJUSTMENT_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: {
            number: created.number,
            amount: created.amount.toString(),
            adjustmentType: created.adjustmentType,
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
      where: { tenantId_code: { tenantId, code: CASH_COUNT_ADJUSTMENT_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: CASH_COUNT_ADJUSTMENT_TYPE,
          documentType: CASH_COUNT_ADJUSTMENT_TYPE,
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
