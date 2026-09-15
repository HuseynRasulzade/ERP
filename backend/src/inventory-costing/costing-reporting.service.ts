import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CostingReportingService (spec sections 78-81). Deliberately separate
 * from InventoryValuationService (spec section 87's "no monolithic
 * service" rule) — this one answers "what did it cost to sell" and "what
 * is open in FIFO", not "what is on hand right now".
 */
@Injectable()
export class CostingReportingService {
  constructor(private readonly prisma: PrismaService) {}

  /** COGS report (spec section 78) — one row per priced outgoing document
   * line. Revenue is intentionally NOT joined here (it lives in Sales
   * Documents/Sales Execution); callers that need gross margin combine
   * this with SalesInvoiceLine data themselves, keeping this service's
   * only dependency on Phase 11's own tables. */
  async cogsReport(tenantId: string, filters: { organizationId?: string; productId?: string; from?: Date; to?: Date }) {
    const movements = await this.prisma.inventoryCostMovement.findMany({
      where: {
        tenantId,
        organizationId: filters.organizationId,
        productId: filters.productId,
        movementType: 'ISSUE',
        effectiveDate: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      },
      orderBy: { effectiveDate: 'desc' },
      take: 5000,
    });
    return movements.map((m) => ({
      date: m.effectiveDate,
      documentType: m.sourceDocumentType,
      documentId: m.sourceDocumentId,
      documentLineId: m.sourceDocumentLineId,
      productId: m.productId,
      quantity: new Decimal(m.quantity.toString()).abs().toString(),
      cogs: new Decimal(m.totalCost.toString()).abs().toString(),
      unitCost: new Decimal(m.unitCost.toString()).abs().toString(),
      provisional: m.provisional,
      costStatus: m.costStatus,
    }));
  }

  /** FIFO layer report (spec section 80). */
  async layerReport(tenantId: string, filters: { organizationId?: string; productId?: string; costingKey?: string }) {
    const layers = await this.prisma.inventoryCostLayer.findMany({
      where: { tenantId, organizationId: filters.organizationId, productId: filters.productId, costingKey: filters.costingKey, sourceDocumentType: { not: 'WAC_BUCKET' } },
      orderBy: [{ receiptDate: 'asc' }, { postingSequence: 'asc' }],
      take: 5000,
    });
    const now = new Date();
    return layers.map((l) => ({
      id: l.id,
      productId: l.productId,
      costingKey: l.costingKey,
      sourceDocumentType: l.sourceDocumentType,
      sourceDocumentId: l.sourceDocumentId,
      receiptDate: l.receiptDate,
      originalQuantity: l.originalQuantity.toString(),
      remainingQuantity: l.remainingQuantity.toString(),
      consumedQuantity: new Decimal(l.originalQuantity.toString()).minus(l.remainingQuantity.toString()).toString(),
      originalUnitCost: l.originalUnitCost.toString(),
      currentUnitCost: l.currentUnitCost.toString(),
      remainingValue: l.currentRemainingValue.toString(),
      status: l.status,
      ageDays: Math.floor((now.getTime() - new Date(l.receiptDate).getTime()) / 86_400_000),
    }));
  }

  /** Cost adjustment report (spec section 81). */
  async adjustmentReport(tenantId: string, filters: { organizationId?: string }) {
    const adjustments = await this.prisma.inventoryCostAdjustment.findMany({
      where: { tenantId, organizationId: filters.organizationId, postingStatus: 'POSTED' },
      include: { lines: true },
      orderBy: { postedAt: 'desc' },
      take: 1000,
    });
    return adjustments.map((a) => ({
      id: a.id,
      number: a.number,
      reason: a.reason,
      sourceDocumentType: a.sourceDocumentType,
      sourceDocumentId: a.sourceDocumentId,
      date: a.postingDate ?? a.documentDate,
      totalAdjustment: a.lines.reduce((s, l) => s.plus(l.adjustmentAmount.toString()), new Decimal(0)).toString(),
      lines: a.lines.map((l) => ({ productId: l.productId, costingKey: l.costingKey, adjustmentAmount: l.adjustmentAmount.toString(), oldUnitCost: l.oldUnitCost?.toString() ?? null, newUnitCost: l.newUnitCost?.toString() ?? null })),
    }));
  }
}
