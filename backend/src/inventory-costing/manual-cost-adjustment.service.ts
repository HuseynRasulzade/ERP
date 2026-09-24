import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine, AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { NumberingService } from '../numbering/numbering.service';
import { RequestContextService } from '../common/context/request-context.service';
import { PermissionCodes } from '../rbac/permission-codes';
import { ConflictAppError, NotFoundAppError, PermissionDeniedError, ValidationAppError } from '../common/errors/app-error';
import { InventoryCostingService } from './inventory-costing.service';
import { InventoryCostAdjustmentService } from './cost-adjustment.service';
import { INVENTORY_COST_ADJUSTMENT_TYPE, d, toDateOnly } from './costing.types';

export const MANUAL_ADJUSTMENT_REASONS = ['LATE_INVOICE_DIFFERENCE', 'SUPPLIER_PRICE_CORRECTION', 'LANDED_COST_CORRECTION', 'MANUAL', 'MIGRATION_CORRECTION'] as const;
const OVERRIDE_REASONS = new Set(['MANUAL', 'MIGRATION_CORRECTION']);

export interface CreateManualAdjustmentInput {
  documentDate: string;
  reason: string;
  comment?: string;
  counterAccountId?: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  lines: { costMovementId: string; amount: string; comment?: string }[];
}

/**
 * InventoryCostAdjustment — manual/authorized cost corrections (spec
 * sections 44-45). A correction is capitalized onto the targeted incoming
 * cost movement (layer) as a MANUAL_ADJUSTMENT component and the engine
 * then replays the key from that receipt: the share of the correction that
 * belongs to already-issued units is pushed to COGS / write-off / internal
 * consumption adjustments, only the on-hand share stays in inventory —
 * never "everything onto current stock" (spec 45, 138).
 * `inventory_cost.adjust` is required for every adjustment; the MANUAL and
 * MIGRATION_CORRECTION reasons additionally need
 * `inventory_cost.manual_override` (spec 34, 44, 97).
 */
@Injectable()
export class ManualCostAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mappings: AccountingMappingService,
    private readonly posting: AccountingPostingEngine,
    private readonly numbering: NumberingService,
    private readonly requestContext: RequestContextService,
    private readonly costing: InventoryCostingService,
    private readonly adjustments: InventoryCostAdjustmentService,
  ) {}

  async create(tenantId: string, organizationId: string, userId: string, input: CreateManualAdjustmentInput) {
    if (!MANUAL_ADJUSTMENT_REASONS.includes(input.reason as any)) throw new ValidationAppError(`reason must be one of ${MANUAL_ADJUSTMENT_REASONS.join(', ')}`);
    if (OVERRIDE_REASONS.has(input.reason) && !this.requestContext.hasPermission(PermissionCodes.INVENTORY_COST_MANUAL_OVERRIDE)) {
      throw new PermissionDeniedError(PermissionCodes.INVENTORY_COST_MANUAL_OVERRIDE);
    }
    if (!input.lines || input.lines.length === 0) throw new ValidationAppError('A cost adjustment needs at least one line');
    const date = toDateOnly(new Date(input.documentDate));
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid documentDate');

    const targets = await this.prisma.inventoryCostMovement.findMany({ where: { tenantId, organizationId, id: { in: input.lines.map((l) => l.costMovementId) } } });
    for (const line of input.lines) {
      const target = targets.find((t) => t.id === line.costMovementId);
      if (!target) throw new NotFoundAppError('InventoryCostMovement', line.costMovementId);
      if (target.movementClass !== 'INCOMING_SOURCED' || target.glTreatment === 'ENGINE') {
        throw new ValidationAppError('A cost adjustment must target a sourced incoming cost movement (goods receipt / opening balance layer)');
      }
      if (d(line.amount).isZero()) throw new ValidationAppError('Adjustment amount must be non-zero');
    }
    if (input.counterAccountId) {
      const account = await this.prisma.account.findFirst({ where: { id: input.counterAccountId, OR: [{ tenantId }, { tenantId: null }] } });
      if (!account) throw new NotFoundAppError('Account', input.counterAccountId);
    }

    await this.adjustments.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const number = await this.numbering.allocateNumber(tenantId, INVENTORY_COST_ADJUSTMENT_TYPE, date, tx);
      const created = await tx.inventoryCostAdjustment.create({
        data: {
          tenantId,
          organizationId,
          number: number.formatted,
          documentDate: date,
          reason: input.reason,
          comment: input.comment,
          counterAccountId: input.counterAccountId,
          sourceDocumentType: input.sourceDocumentType,
          sourceDocumentId: input.sourceDocumentId,
          status: 'DRAFT',
          createdBy: userId,
          lines: {
            create: input.lines.map((l, i) => {
              const t = targets.find((x) => x.id === l.costMovementId)!;
              return { tenantId, position: i, productId: t.productId, warehouseId: t.physicalWarehouseId, costingKey: t.costingKey, costMovementId: t.id, quantityReference: d(t.quantity).abs().toString(), oldCost: d(t.totalCost).abs().toString(), adjustmentAmount: d(l.amount).toString(), newCost: d(t.totalCost).abs().plus(d(l.amount)).toString(), impactType: 'INVENTORY', comment: l.comment };
            }),
          },
        },
        include: { lines: true },
      });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COST_ADJUSTMENT_CREATED', entityType: INVENTORY_COST_ADJUSTMENT_TYPE, entityId: created.id, action: 'CREATE', userId, newValues: { number: created.number, reason: input.reason, lines: input.lines } }, tx);
      return created;
    });
  }

  async post(tenantId: string, organizationId: string, id: string, userId: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const adjustment = await tx.inventoryCostAdjustment.findFirst({ where: { id, tenantId, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
      if (!adjustment) throw new NotFoundAppError('InventoryCostAdjustment', id);
      if (adjustment.status !== 'DRAFT') throw new ConflictAppError(`Cost adjustment ${adjustment.number} is ${adjustment.status}`);
      if (adjustment.isSystemGenerated) throw new ConflictAppError('System-generated cost adjustments cannot be posted manually');
      if (OVERRIDE_REASONS.has(adjustment.reason) && !this.requestContext.hasPermission(PermissionCodes.INVENTORY_COST_MANUAL_OVERRIDE)) {
        throw new PermissionDeniedError(PermissionCodes.INVENTORY_COST_MANUAL_OVERRIDE);
      }
      await this.costing.lockOrganization(tx, tenantId, organizationId);

      const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, adjustment.documentDate, tx);
      const lines: AccountingPostingLineInput[] = [];
      let total = new Decimal(0);
      for (const l of adjustment.lines) {
        const amount = d(l.adjustmentAmount);
        total = total.plus(amount);
        const counterId = adjustment.counterAccountId ?? (await this.mappings.resolve(tenantId, organizationId, amount.gt(0) ? MappingKeys.OTHER_OPERATING_INCOME : MappingKeys.OTHER_OPERATING_EXPENSE, adjustment.documentDate, tx)).id;
        const dims = [{ dimensionCode: 'PRODUCT', referenceId: l.productId }, { dimensionCode: 'WAREHOUSE', referenceId: l.warehouseId! }];
        lines.push(
          { accountId: inventory.id, side: amount.gt(0) ? 'DEBIT' : 'CREDIT', amountBase: amount.abs(), description: `Cost adjustment ${adjustment.number}`, dimensions: dims },
          { accountId: counterId, side: amount.gt(0) ? 'CREDIT' : 'DEBIT', amountBase: amount.abs(), description: `Cost adjustment ${adjustment.number}`, dimensions: dims },
        );
      }
      await tx.inventoryCostAdjustment.update({ where: { id }, data: { status: 'POSTED', postingDate: adjustment.documentDate, postedAt: new Date(), postedBy: userId, inventoryImpact: total.toString(), version: { increment: 1 } } });
      const entry = await this.posting.postBatch(tenantId, userId, { organizationId, businessDate: adjustment.documentDate, postingDate: adjustment.documentDate, description: `Inventory cost adjustment ${adjustment.number} (${adjustment.reason})`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: INVENTORY_COST_ADJUSTMENT_TYPE, sourceDocumentId: id, lines }, tx);
      await tx.inventoryCostAdjustment.update({ where: { id }, data: { journalEntryId: (entry as any)?.id ?? null } });

      // Capitalize onto the layer and distribute consumed shares (spec 45).
      await this.costing.onIncomingValueChanged(tenantId, [], { type: INVENTORY_COST_ADJUSTMENT_TYPE, id, reason: adjustment.reason }, tx, userId, adjustment.lines.map((l) => l.costMovementId!).filter(Boolean));

      await this.audit.record({ tenantId, eventType: 'INVENTORY_COST_MANUAL_ADJUSTMENT_POSTED', entityType: INVENTORY_COST_ADJUSTMENT_TYPE, entityId: id, action: 'POST', userId, newValues: { number: adjustment.number, reason: adjustment.reason, total: total.toString() } }, tx);
      return tx.inventoryCostAdjustment.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
  }
}
