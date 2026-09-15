import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface ProductionKPIResult {
  productionOrderId: string;
  plannedQuantity: string;
  actualQuantity: string;
  yieldPct: string;
  scrapQtyPct: string;
  actualUnitCost: string | null;
  costStatus: 'PROVISIONAL' | 'FINAL';
}

/**
 * ProductionKPIService (docx spec Phase 24, sections 75-80). Reads
 * Phase 21's own authoritative `ProductionOrderOutput`/`ScrapRecord`/
 * `ProductionCostMovement` tables directly — never recomputes actual
 * cost, which always comes from Phase 21's provisional/final cost
 * transfer, never a standard BOM cost (spec section 34, 78). Yield and
 * scrap-quantity% are kept as SEPARATE measures (spec sections 76-77) —
 * scrap-COST% is not implemented in this build (disclosed,
 * docs/MANAGEMENT_REPORTING.md section I). Material/labor/overhead
 * variance bridge (spec section 80) reuses Phase 21's own
 * `ProductionVariance` rows rather than recomputing them.
 */
@Injectable()
export class ProductionKPIService {
  constructor(private readonly prisma: PrismaService) {}

  async orderKPIs(tenantId: string, organizationId: string, productionOrderId: string): Promise<ProductionKPIResult> {
    const order = await this.prisma.productionOrder.findFirstOrThrow({ where: { id: productionOrderId, tenantId, organizationId }, include: { outputs: true } });
    const scrap = await this.prisma.scrapRecord.findMany({ where: { tenantId, productionOrderId } });
    const costMovements = await this.prisma.productionCostMovement.findMany({ where: { tenantId, productionOrderId, reversed: false } });

    const actualQuantity = order.outputs.reduce((s, o) => s.plus(o.receivedQuantity.toString()), new Decimal(0));
    const plannedQuantity = new Decimal(order.plannedOutputQuantity.toString());
    const scrapQty = scrap.reduce((s, r) => s.plus(r.quantity.toString()), new Decimal(0));
    const totalProcessed = actualQuantity.plus(scrapQty);

    const yieldPct = totalProcessed.eq(0) ? new Decimal(0) : actualQuantity.div(totalProcessed).mul(100);
    const scrapQtyPct = totalProcessed.eq(0) ? new Decimal(0) : scrapQty.div(totalProcessed).mul(100);

    const totalCostIn = costMovements.reduce((s, m) => s.plus(m.costIn.toString()), new Decimal(0));
    const totalCostOut = costMovements.reduce((s, m) => s.plus(m.costOut.toString()), new Decimal(0));
    const netCost = totalCostIn.minus(totalCostOut);
    const actualUnitCost = actualQuantity.gt(0) ? netCost.div(actualQuantity) : null;
    const costStatus = order.closeStatus === 'CLOSED' ? 'FINAL' : 'PROVISIONAL'; // spec section 78 — mandatory label

    return {
      productionOrderId,
      plannedQuantity: plannedQuantity.toFixed(4),
      actualQuantity: actualQuantity.toFixed(4),
      yieldPct: yieldPct.toFixed(2),
      scrapQtyPct: scrapQtyPct.toFixed(2),
      actualUnitCost: actualUnitCost?.toFixed(4) ?? null,
      costStatus,
    };
  }

  varianceBridge(tenantId: string, organizationId: string, productionOrderId: string) {
    return this.prisma.productionVariance.findMany({ where: { tenantId, productionOrderId, order: { organizationId } } });
  }

  /** Work Center Utilization (spec section 79) — actual hours logged
   * against a work center vs its own `capacityHoursPerDay` × the number
   * of calendar days in the window. */
  async workCenterUtilization(tenantId: string, organizationId: string, workCenterId: string, periodStart: Date, periodEnd: Date) {
    const workCenter = await this.prisma.workCenter.findFirstOrThrow({ where: { id: workCenterId, tenantId, organizationId } });
    const machineHours = await this.prisma.machineTimeInput.aggregate({ where: { tenantId, workCenterId, workDate: { gte: periodStart, lte: periodEnd } }, _sum: { hours: true } });
    const days = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1);
    const capacity = new Decimal(workCenter.capacityHoursPerDay?.toString() ?? '0').mul(days);
    const actual = new Decimal((machineHours._sum.hours ?? 0).toString());
    return { actualHours: actual.toFixed(2), capacityHours: capacity.toFixed(2), utilizationPct: capacity.eq(0) ? null : actual.div(capacity).mul(100).toFixed(2) };
  }
}
