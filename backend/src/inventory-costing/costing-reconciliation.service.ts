import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryCostRecalculationService } from './inventory-cost-recalculation.service';

export interface HealthFinding {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  message: string;
}

/**
 * CostingReconciliationService (spec sections 63-66, 82, 118, 132). Two
 * kinds of check this codebase's own posting flow cannot catch by
 * construction:
 *   1. Quantity vs cost-layer reconciliation — Phase 10's InventoryMovement
 *      quantity balance for a costing key's dimensions vs the SUM of open
 *      FIFO layer remaining quantities (or the WAC bucket quantity) should
 *      match; any drift is a costing bug worth surfacing, not silently
 *      tolerating (spec section 64).
 *   2. Costing health — unresolved errors, pending recalculation, zero
 *      quantity with nonzero value and vice versa (spec sections 65-66).
 */
@Injectable()
export class CostingReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recalculation: InventoryCostRecalculationService,
  ) {}

  async reconcileCostingKey(tenantId: string, costingKey: string): Promise<{ costingKey: string; physicalQuantity: Decimal; layerQuantity: Decimal; difference: Decimal }> {
    const movementSum = await this.prisma.inventoryCostMovement.aggregate({ where: { tenantId, costingKey }, _sum: { quantity: true } });
    const physicalQuantity = new Decimal((movementSum._sum.quantity ?? 0).toString());

    const layers = await this.prisma.inventoryCostLayer.findMany({ where: { tenantId, costingKey }, select: { remainingQuantity: true } });
    const layerQuantity = layers.reduce((sum, l) => sum.plus(l.remainingQuantity.toString()), new Decimal(0));

    return { costingKey, physicalQuantity, layerQuantity, difference: physicalQuantity.minus(layerQuantity) };
  }

  async health(tenantId: string, organizationId?: string): Promise<HealthFinding[]> {
    const findings: HealthFinding[] = [];

    const errors = await this.prisma.inventoryCostingError.findMany({ where: { tenantId, organizationId, resolved: false }, take: 500 });
    for (const e of errors) {
      findings.push({ code: e.errorCode, severity: e.severity as HealthFinding['severity'], message: e.description });
    }

    const pending = await this.recalculation.pendingCount(tenantId, organizationId);
    if (pending > 0) findings.push({ code: 'PENDING_RECALCULATION', severity: 'WARNING', message: `${pending} costing key(s) awaiting recalculation.` });

    const uncosted = await this.prisma.inventoryCostMovement.count({ where: { tenantId, organizationId, costStatus: { in: ['UNCALCULATED', 'RECALCULATION_REQUIRED'] } } });
    if (uncosted > 0) findings.push({ code: 'UNCOSTED_MOVEMENTS', severity: 'WARNING', message: `${uncosted} inventory movement(s) have no final cost yet.` });

    const provisional = await this.prisma.inventoryCostMovement.count({ where: { tenantId, organizationId, provisional: true } });
    if (provisional > 0) findings.push({ code: 'PROVISIONAL_MOVEMENTS', severity: 'INFO', message: `${provisional} movement(s) still carry a provisional cost.` });

    // Zero-quantity-with-value / nonzero-quantity-with-zero-value (spec
    // sections 65-66), scanned per open/partially-consumed layer.
    const layers = await this.prisma.inventoryCostLayer.findMany({ where: { tenantId, organizationId, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] } }, take: 2000 });
    for (const l of layers) {
      const qty = new Decimal(l.remainingQuantity.toString());
      const value = new Decimal(l.currentRemainingValue.toString());
      if (qty.lte(0) && value.gt(0)) findings.push({ code: 'ZERO_QUANTITY_WITH_VALUE', severity: 'ERROR', message: `Layer ${l.id} has zero/negative quantity but a remaining value of ${value.toString()}.` });
      if (qty.gt(0) && value.lte(0) && new Decimal(l.currentUnitCost.toString()).lte(0)) {
        findings.push({ code: 'NONZERO_QUANTITY_ZERO_VALUE', severity: 'INFO', message: `Layer ${l.id} has ${qty.toString()} units at zero cost — verify this is a legitimate free-goods/consignment item, not an uncosted receipt.` });
      }
    }

    return findings;
  }

  async reconcileAllCostingKeys(tenantId: string, organizationId?: string) {
    const keys = await this.prisma.inventoryCostMovement.findMany({ where: { tenantId, organizationId }, distinct: ['costingKey'], select: { costingKey: true } });
    const results = [];
    for (const { costingKey } of keys) {
      const r = await this.reconcileCostingKey(tenantId, costingKey);
      if (!r.difference.abs().lt(new Decimal('0.000001'))) results.push(r);
    }
    return results;
  }
}
