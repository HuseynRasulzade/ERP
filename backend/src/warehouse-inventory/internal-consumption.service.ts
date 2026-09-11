import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { INTERNAL_CONSUMPTION_TYPE } from './internal-consumption.repository';
import { CreateInternalConsumptionDto } from './dto/warehouse-inventory.dto';

const SEQUENCE_PREFIX = 'ICN';

@Injectable()
export class InternalConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.internalConsumption.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.internalConsumption.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('InternalConsumption', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateInternalConsumptionDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, organizationId } });
    if (!warehouse) throw new ValidationAppError('Warehouse does not belong to this organization');
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: dto.departmentId, organizationId } });
      if (!dept) throw new ValidationAppError('Department does not belong to this organization');
    }

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, INTERNAL_CONSUMPTION_TYPE, businessDate, tx);

      const header = await tx.internalConsumption.create({
        data: {
          tenantId,
          organizationId,
          warehouseId: dto.warehouseId,
          departmentId: dto.departmentId,
          operationType: dto.operationType ?? 'OFFICE_CONSUMPTION',
          number: allocated.formatted,
          documentDate: businessDate,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of dto.lines.entries()) {
        await tx.internalConsumptionLine.create({
          data: {
            tenantId,
            internalConsumptionId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: new Decimal(line.quantity.toString()),
            batchId: line.batchId,
            purpose: line.purpose,
            expenseAccountId: line.expenseAccountId,
            description: line.description,
          },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'INTERNAL_CONSUMPTION_CREATED', entityType: INTERNAL_CONSUMPTION_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, lineCount: dto.lines.length } },
        tx,
      );

      return tx.internalConsumption.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INTERNAL_CONSUMPTION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INTERNAL_CONSUMPTION_TYPE, documentType: INTERNAL_CONSUMPTION_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
