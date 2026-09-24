import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { InventoryCostingService } from './inventory-costing.service';
import { INVENTORY_COST_ADJUSTMENT_TYPE } from './inventory-cost-adjustment.repository';
import { CreateInventoryCostAdjustmentDto } from './dto/inventory-cost-adjustment.dto';

const SEQUENCE_PREFIX = 'ICA';

/**
 * Manual inventory cost adjustment creation (spec section 44). The
 * subledger mutation happens HERE, at create time, via
 * `InventoryCostingService.applyCostDelta` — the exact same moment
 * `AdditionalPurchaseCostPostingHandler` touches a cost layer — so posting
 * (`InventoryCostAdjustmentPostingHandler`) only has to turn the already
 * computed `onHandAmount`/`cogsAmount` split into a GL entry, never
 * re-deriving it.
 */
@Injectable()
export class InventoryCostAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly costing: InventoryCostingService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.inventoryCostAdjustment.findMany({ where: { tenantId, organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.inventoryCostAdjustment.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
    if (!row) throw new NotFoundAppError('InventoryCostAdjustment', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateInventoryCostAdjustmentDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    if (dto.lines.some((l) => l.amount === 0)) throw new ValidationAppError('Every adjustment line must carry a non-zero amount');

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, INVENTORY_COST_ADJUSTMENT_TYPE, businessDate, tx);

      const header = await tx.inventoryCostAdjustment.create({
        data: { tenantId, organizationId, number: allocated.formatted, documentDate: businessDate, reason: dto.reason, comment: dto.comment, createdBy: userId, updatedBy: userId },
      });

      for (const [position, line] of dto.lines.entries()) {
        const split = await this.costing.applyCostDelta(
          tenantId,
          {
            organizationId,
            productId: line.productId,
            warehouseId: line.warehouseId,
            batchId: line.batchId,
            sourceReceiptLineId: line.sourceReceiptLineId,
            amount: line.amount,
            effectiveDate: businessDate,
            sourceDocumentType: INVENTORY_COST_ADJUSTMENT_TYPE,
            sourceDocumentId: header.id,
            sourceDocumentLineId: undefined,
            componentType: 'MANUAL_ADJUSTMENT',
          },
          tx,
        );
        if (!split) {
          throw new ValidationAppError(`No inventory costing policy configured for this organization — cannot apply a cost adjustment for product ${line.productId}`);
        }

        await tx.inventoryCostAdjustmentLine.create({
          data: {
            tenantId,
            inventoryCostAdjustmentId: header.id,
            position,
            productId: line.productId,
            warehouseId: line.warehouseId,
            costingKey: split.costingKey,
            costLayerId: split.costLayerId,
            oldCost: '0',
            adjustmentAmount: line.amount.toString(),
            newCost: '0',
            onHandAmount: split.onHandAmount.toString(),
            cogsAmount: split.cogsAmount.toString(),
          },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'INVENTORY_COST_ADJUSTMENT_CREATED', entityType: INVENTORY_COST_ADJUSTMENT_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, reason: dto.reason, lineCount: dto.lines.length } },
        tx,
      );

      return tx.inventoryCostAdjustment.findFirst({ where: { id: header.id }, include: { lines: true } });
    });
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
