import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_ADJUSTMENT_TYPE } from './inventory-adjustment.repository';
import { CreateInventoryAdjustmentDto } from './dto/warehouse-inventory.dto';

const SEQUENCE_PREFIX = 'IADJ';

@Injectable()
export class InventoryAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.inventoryAdjustment.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.inventoryAdjustment.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('InventoryAdjustment', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateInventoryAdjustmentDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, organizationId } });
    if (!warehouse) throw new ValidationAppError('Warehouse does not belong to this organization');

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, INVENTORY_ADJUSTMENT_TYPE, businessDate, tx);

      const header = await tx.inventoryAdjustment.create({
        data: {
          tenantId,
          organizationId,
          warehouseId: dto.warehouseId,
          adjustmentType: dto.adjustmentType,
          reasonCode: dto.reasonCode,
          number: allocated.formatted,
          documentDate: businessDate,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of dto.lines.entries()) {
        await tx.inventoryAdjustmentLine.create({
          data: {
            tenantId,
            inventoryAdjustmentId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: new Decimal(line.quantity.toString()),
            batchId: line.batchId,
            stockStatus: line.stockStatus ?? 'AVAILABLE',
            costReference: line.costReference != null ? new Decimal(line.costReference.toString()) : undefined,
            description: line.description,
          },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'INVENTORY_ADJUSTMENT_CREATED', entityType: INVENTORY_ADJUSTMENT_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, adjustmentType: dto.adjustmentType, lineCount: dto.lines.length } },
        tx,
      );

      return tx.inventoryAdjustment.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INVENTORY_ADJUSTMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INVENTORY_ADJUSTMENT_TYPE, documentType: INVENTORY_ADJUSTMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
