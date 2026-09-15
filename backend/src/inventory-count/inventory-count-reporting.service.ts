import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * InventoryCountReportingService (spec sections 87-94). Read-only
 * aggregation over this module's own tables — never re-derives Phase
 * 10/11 balances itself (those come from the snapshot/variance rows
 * already computed by `InventorySnapshotService`/`InventoryVarianceService`).
 */
@Injectable()
export class InventoryCountReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async varianceReport(tenantId: string, sessionId: string) {
    return this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId }, include: { decision: true }, orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] });
  }

  async surplusShortageReport(tenantId: string, sessionId: string) {
    const variances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, varianceType: { in: ['SURPLUS', 'SHORTAGE'] } } });
    return { surpluses: variances.filter((v) => v.varianceType === 'SURPLUS'), shortages: variances.filter((v) => v.varianceType === 'SHORTAGE') };
  }

  async progress(tenantId: string, sessionId: string) {
    const session = await this.prisma.inventoryCountSession.findFirstOrThrow({ where: { id: sessionId, tenantId } });
    const totalScopeLines = await this.prisma.inventoryCountSnapshotLine.count({ where: { tenantId, sessionId, snapshotVersion: session.snapshotVersion } });
    const entries = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId }, select: { id: true, supersedesEntryId: true } });
    const supersededIds = new Set(entries.map((e) => e.supersedesEntryId).filter(Boolean));
    const countedLines = entries.filter((e) => !supersededIds.has(e.id)).length;
    const recountsPending = await this.prisma.inventoryRecount.count({ where: { tenantId, sessionId, resultStatus: 'PENDING' } });
    const variances = await this.prisma.inventoryVariance.count({ where: { tenantId, sessionId } });
    const approved = await this.prisma.inventoryVariance.count({ where: { tenantId, sessionId, resolutionStatus: { in: ['APPROVED', 'POSTED'] } } });
    const posted = await this.prisma.inventoryVariance.count({ where: { tenantId, sessionId, resolutionStatus: 'POSTED' } });

    return {
      totalScopeLines,
      countedLines,
      uncountedLines: Math.max(totalScopeLines - countedLines, 0),
      recountsPending,
      variances,
      approved,
      posted,
      percentComplete: totalScopeLines > 0 ? Math.round((countedLines / totalScopeLines) * 100) : 0,
      freezeStatus: session.freezePolicy,
      status: session.status,
    };
  }

  /** Product count history (spec section 91) — historical loss-pattern
   * analysis across every count session a product has ever appeared in. */
  async productHistory(tenantId: string, productId: string) {
    const variances = await this.prisma.inventoryVariance.findMany({
      where: { tenantId, productId },
      include: { decision: true, session: { select: { sessionNumber: true, organizationId: true, snapshotAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return variances.map((v) => ({
      date: v.session.snapshotAt,
      sessionNumber: v.session.sessionNumber,
      accountingQty: v.accountingQuantity.toString(),
      physicalQty: v.physicalQuantity?.toString() ?? null,
      difference: v.quantityDifference.toString(),
      reason: v.reasonCode,
      warehouseId: v.warehouseId,
      resolution: v.decision?.resolutionType ?? null,
    }));
  }

  async serialVarianceReport(tenantId: string, sessionId: string) {
    return this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, varianceType: { in: ['SERIAL_MISSING', 'SERIAL_UNEXPECTED'] } } });
  }

  async batchVarianceReport(tenantId: string, sessionId: string) {
    return this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, batchId: { not: null } }, orderBy: { productId: 'asc' } });
  }

  /** Location reconciliation suggestion (spec section 94) — a simple
   * heuristic pairing a shortage at one location with a surplus of the
   * SAME product/quantity at another within the same session; a
   * suggestion only, never auto-applied. */
  async locationReconciliationSuggestions(tenantId: string, sessionId: string) {
    const variances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, locationId: { not: null } } });
    const suggestions: { productId: string; fromLocationId: string; toLocationId: string; quantity: string }[] = [];
    const shortages = variances.filter((v) => v.varianceType === 'SHORTAGE');
    const surpluses = variances.filter((v) => v.varianceType === 'SURPLUS');
    for (const s of shortages) {
      const match = surpluses.find((sp) => sp.productId === s.productId && sp.quantityDifference.abs().equals(s.quantityDifference.abs()));
      if (match) suggestions.push({ productId: s.productId, fromLocationId: s.locationId!, toLocationId: match.locationId!, quantity: s.quantityDifference.abs().toString() });
    }
    return suggestions;
  }
}
