import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_COST_ADJUSTMENT_TYPE } from './inventory-cost-adjustment.repository';
import { RecalculationDelta } from './inventory-cost-recalculation.service';
import { CreateInventoryCostAdjustmentDto } from './dto/inventory-costing.dto';

const SEQUENCE_PREFIX = 'ICADJ';

@Injectable()
export class InventoryCostAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.inventoryCostAdjustment.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.inventoryCostAdjustment.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('InventoryCostAdjustment', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateInventoryCostAdjustmentDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, INVENTORY_COST_ADJUSTMENT_TYPE, businessDate, tx);
      const header = await tx.inventoryCostAdjustment.create({
        data: {
          tenantId,
          organizationId,
          reason: dto.reason,
          sourceDocumentType: dto.sourceDocumentType,
          sourceDocumentId: dto.sourceDocumentId,
          number: allocated.formatted,
          documentDate: businessDate,
          comment: dto.comment,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of dto.lines.entries()) {
        await tx.inventoryCostAdjustmentLine.create({
          data: {
            tenantId,
            adjustmentId: header.id,
            position: index,
            productId: line.productId,
            costingKey: line.costingKey,
            costLayerId: line.costLayerId,
            warehouseId: line.warehouseId,
            quantityReference: line.quantityReference != null ? new Decimal(line.quantityReference.toString()).toString() : undefined,
            oldUnitCost: line.oldUnitCost != null ? new Decimal(line.oldUnitCost.toString()).toString() : undefined,
            adjustmentAmount: new Decimal(line.adjustmentAmount.toString()).toString(),
            notes: line.notes,
          },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'INVENTORY_COST_ADJUSTMENT_CREATED', entityType: INVENTORY_COST_ADJUSTMENT_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, reason: dto.reason, lineCount: dto.lines.length } },
        tx,
      );

      return tx.inventoryCostAdjustment.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  /** Materializes a DRAFT adjustment document from a recalculation run's
   * deltas (spec section 116: "No accounting posting until confirmed") —
   * the accountant reviews it and posts through the normal document
   * command surface, same as any other document in this codebase. */
  async createFromRecalculationDeltas(tenantId: string, organizationId: string, calculationRunId: string, deltas: RecalculationDelta[], userId: string, tx: PrismaTransactionClient) {
    if (deltas.length === 0) return null;
    const businessDate = new Date();
    const allocated = await this.numbering.allocateNumber(tenantId, INVENTORY_COST_ADJUSTMENT_TYPE, businessDate, tx);
    const header = await tx.inventoryCostAdjustment.create({
      data: {
        tenantId,
        organizationId,
        reason: 'SYSTEM_RECALCULATION',
        number: allocated.formatted,
        documentDate: businessDate,
        comment: `Auto-generated from calculation run ${calculationRunId}`,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    for (const [index, delta] of deltas.entries()) {
      await tx.inventoryCostAdjustmentLine.create({
        data: {
          tenantId,
          adjustmentId: header.id,
          position: index,
          productId: delta.productId,
          costingKey: delta.costingKey,
          oldUnitCost: undefined,
          adjustmentAmount: delta.delta.toString(),
          notes: `${delta.outgoingDocumentType} ${delta.outgoingDocumentId}: ${delta.oldCost.toString()} -> ${delta.newCost.toString()}`,
        },
      });
    }
    return header;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INVENTORY_COST_ADJUSTMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INVENTORY_COST_ADJUSTMENT_TYPE, documentType: INVENTORY_COST_ADJUSTMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
