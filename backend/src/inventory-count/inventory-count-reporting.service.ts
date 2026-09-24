import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RequestContextService } from '../common/context/request-context.service';
import { PermissionCodes } from '../rbac/permission-codes';
import { OPEN_SESSION_STATUSES, dec } from './inventory-count.constants';
import { InventoryCountSessionService } from './inventory-count-session.service';

/**
 * InventoryCountReportingService (spec sections 87-94, 106-107): progress,
 * dashboard, variance / surplus-shortage / count-history / serial / batch /
 * location reports, plus the Phase 22 (month close) and Phase 30
 * (accounting health) integration queries. Values are redacted without
 * INVENTORY_COUNT_VIEW_COST; accounting quantities without
 * INVENTORY_COUNT_VIEW_ACCOUNTING_QTY.
 */
@Injectable()
export class InventoryCountReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly requestContext: RequestContextService,
    private readonly sessions: InventoryCountSessionService,
  ) {}

  private get canSeeCost() {
    return this.requestContext.hasPermission(PermissionCodes.INVENTORY_COUNT_VIEW_COST);
  }
  private get canSeeQty() {
    return this.requestContext.hasPermission(PermissionCodes.INVENTORY_COUNT_VIEW_ACCOUNTING_QTY);
  }

  async progress(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    return this.progressFor(tenantId, session);
  }

  async progressFor(tenantId: string, session: { id: string; snapshotVersion: number; calculationVersion: number }) {
    const snapshotKeys = await this.prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId: session.id, snapshotVersion: session.snapshotVersion }, select: { lineKey: true } });
    const countedKeys = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId: session.id, status: 'ACTIVE', lineKey: { not: null } }, select: { lineKey: true }, distinct: ['lineKey'] });
    const expected = new Set(snapshotKeys.map((k) => k.lineKey));
    const counted = new Set(countedKeys.map((k) => k.lineKey!));
    const all = new Set([...expected, ...counted]);
    const countedExpected = Array.from(expected).filter((k) => counted.has(k)).length;
    const variances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, resolutionStatus: { not: 'SUPERSEDED' } }, select: { varianceType: true, resolutionStatus: true } });
    const recountPending = await this.prisma.inventoryRecount.count({ where: { tenantId, sessionId: session.id, resultStatus: 'PENDING' } });
    return {
      totalScopeLines: all.size,
      expectedLines: expected.size,
      countedLines: counted.size,
      uncountedLines: expected.size - countedExpected,
      unexpectedLines: Array.from(counted).filter((k) => !expected.has(k)).length,
      recountPending,
      variances: variances.filter((v) => v.varianceType !== 'MATCH').length,
      approved: variances.filter((v) => v.resolutionStatus === 'APPROVED' || v.resolutionStatus === 'AUTO_ACCEPTED').length,
      posted: variances.filter((v) => v.resolutionStatus === 'POSTED').length,
      percentComplete: expected.size === 0 ? (counted.size > 0 ? 100 : 0) : Math.round((countedExpected / expected.size) * 10000) / 100,
    };
  }

  /** Inventory count dashboard (spec section 88). */
  async dashboard(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const sessions = await this.prisma.inventoryCountSession.findMany({ where: { tenantId, organizationId, status: { in: OPEN_SESSION_STATUSES } }, include: { plan: true }, orderBy: { startedAt: 'desc' } });
    const out = [];
    for (const s of sessions) {
      const progress = await this.progressFor(tenantId, s);
      const lines = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: s.id, calculationVersion: s.calculationVersion, resolutionStatus: { not: 'SUPERSEDED' } }, select: { quantityDifference: true, valueDifference: true, warehouseId: true } });
      const warehouses = await this.prisma.inventoryCountSheet.findMany({ where: { tenantId, sessionId: s.id }, select: { warehouseId: true }, distinct: ['warehouseId'] });
      const whRows = await this.prisma.warehouse.findMany({ where: { id: { in: warehouses.map((w) => w.warehouseId) } }, select: { code: true, name: true } });
      const shortage = lines.filter((l) => dec(l.quantityDifference).lt(0)).reduce((a, l) => a.plus(dec(l.valueDifference).abs()), new Decimal(0));
      const surplus = lines.filter((l) => dec(l.quantityDifference).gt(0)).reduce((a, l) => a.plus(dec(l.valueDifference)), new Decimal(0));
      out.push({
        planId: s.planId,
        sessionId: s.id,
        sessionNumber: s.sessionNumber,
        countType: s.plan.countType,
        status: s.status,
        warehouses: whRows,
        progressPercent: progress.percentComplete,
        countedItems: progress.countedLines,
        varianceLines: progress.variances,
        shortageValue: this.canSeeCost ? shortage.toString() : undefined,
        surplusValue: this.canSeeCost ? surplus.toString() : undefined,
        recountsPending: progress.recountPending,
        approvalsPending: s.status === 'PENDING_APPROVAL' ? 1 : 0,
        freezeStatus: s.freezeActive ? s.freezePolicy : 'NONE',
        reconciliationStatus: s.reconciliationStatus,
      });
    }
    return out;
  }

  /** Variance report (spec section 89) across sessions. */
  async varianceReport(tenantId: string, membershipId: string, organizationId: string, filter: { sessionId?: string; warehouseId?: string; productId?: string; from?: string; to?: string; onlyDifferences?: boolean }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const sessions = await this.prisma.inventoryCountSession.findMany({
      where: { tenantId, organizationId, ...(filter.sessionId ? { id: filter.sessionId } : {}), ...(filter.from || filter.to ? { snapshotAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } } : {}) },
      select: { id: true, sessionNumber: true, calculationVersion: true, snapshotAt: true },
    });
    const rows = [];
    for (const s of sessions) {
      const lines = await this.prisma.inventoryVariance.findMany({
        where: { tenantId, sessionId: s.id, calculationVersion: s.calculationVersion, resolutionStatus: { not: 'SUPERSEDED' }, ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}), ...(filter.productId ? { productId: filter.productId } : {}), ...(filter.onlyDifferences ? { varianceType: { not: 'MATCH' } } : {}) },
      });
      rows.push(...(await this.decorate(lines)).map((l) => ({ ...l, sessionNumber: s.sessionNumber, countDate: s.snapshotAt })));
    }
    return rows.map((r) => this.redactRow(r));
  }

  /** Surplus / shortage report (spec section 90) — from posted adjustment documents. */
  async surplusShortageReport(tenantId: string, membershipId: string, organizationId: string, filter: { groupBy?: string; from?: string; to?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const docs = await this.prisma.inventoryCountAdjustment.findMany({
      where: { tenantId, organizationId, postingStatus: 'POSTED', operationType: { in: ['INVENTORY_SURPLUS', 'INVENTORY_SHORTAGE'] }, ...(filter.from || filter.to ? { documentDate: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } } : {}) },
      include: { lines: true },
    });
    const productIds = Array.from(new Set(docs.flatMap((d) => d.lines.map((l) => l.productId))));
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, categoryId: true } });
    const cat = new Map(products.map((p) => [p.id, p.categoryId]));
    const groupBy = filter.groupBy ?? 'warehouse';
    const groups = new Map<string, { key: string; surplusQty: Decimal; shortageQty: Decimal; surplusValue: Decimal; shortageValue: Decimal; lines: number }>();
    for (const d of docs) {
      for (const l of d.lines) {
        const key =
          groupBy === 'productGroup' ? cat.get(l.productId) ?? 'UNCATEGORIZED'
          : groupBy === 'responsible' ? l.responsibleEmployeeId ?? 'NONE'
          : groupBy === 'reason' ? l.reasonCode ?? 'NONE'
          : groupBy === 'period' ? d.documentDate.toISOString().slice(0, 7)
          : d.warehouseId;
        const g = groups.get(key) ?? { key, surplusQty: new Decimal(0), shortageQty: new Decimal(0), surplusValue: new Decimal(0), shortageValue: new Decimal(0), lines: 0 };
        const amount = l.amount != null ? dec(l.amount) : new Decimal(0);
        if (d.operationType === 'INVENTORY_SURPLUS') {
          g.surplusQty = g.surplusQty.plus(dec(l.quantity));
          g.surplusValue = g.surplusValue.plus(amount);
        } else {
          g.shortageQty = g.shortageQty.plus(dec(l.quantity));
          g.shortageValue = g.shortageValue.plus(amount);
        }
        g.lines += 1;
        groups.set(key, g);
      }
    }
    return Array.from(groups.values()).map((g) => ({
      groupBy,
      key: g.key,
      surplusQty: g.surplusQty.toString(),
      shortageQty: g.shortageQty.toString(),
      surplusValue: this.canSeeCost ? g.surplusValue.toString() : undefined,
      shortageValue: this.canSeeCost ? g.shortageValue.toString() : undefined,
      lines: g.lines,
    }));
  }

  /** Count history per product (spec section 91). */
  async countHistory(tenantId: string, membershipId: string, organizationId: string, productId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const sessions = await this.prisma.inventoryCountSession.findMany({ where: { tenantId, organizationId, calculationVersion: { gt: 0 } }, select: { id: true, sessionNumber: true, calculationVersion: true, snapshotAt: true, approvedBy: true } });
    const out = [];
    for (const s of sessions) {
      const lines = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: s.id, productId, calculationVersion: s.calculationVersion, resolutionStatus: { not: 'SUPERSEDED' } } });
      for (const l of lines) {
        const adj = await this.prisma.inventoryCountAdjustmentLine.findMany({ where: { tenantId, OR: [{ varianceId: l.id }, { counterVarianceId: l.id }] }, include: { adjustment: { select: { number: true, operationType: true, postingStatus: true } } } });
        out.push({
          date: s.snapshotAt,
          inventoryCount: s.sessionNumber,
          warehouseId: l.warehouseId,
          locationId: l.locationId,
          accountingQty: this.canSeeQty ? l.adjustedAccountingQuantity.toString() : undefined,
          physicalQty: l.physicalQuantity?.toString() ?? null,
          difference: this.canSeeQty ? l.quantityDifference.toString() : undefined,
          adjustments: adj.map((a) => ({ number: a.adjustment.number, operationType: a.adjustment.operationType, postingStatus: a.adjustment.postingStatus })),
          user: l.approvedBy ?? s.approvedBy,
          reason: l.reasonCode,
          varianceType: l.varianceType,
        });
      }
    }
    return out.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }

  /** Serial variance report (spec section 92). */
  async serialReport(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const expected = await this.prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId: session.id, snapshotVersion: session.snapshotVersion, serialId: { not: null } } });
    const found = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId: session.id, status: 'ACTIVE', OR: [{ serialId: { not: null } }, { serialNumberText: { not: null } }], baseQuantity: { gt: 0 } } });
    const serialIds = Array.from(new Set([...expected.map((e) => e.serialId!), ...found.map((f) => f.serialId).filter((x): x is string => !!x)]));
    const serials = await this.prisma.serialNumber.findMany({ where: { id: { in: serialIds } }, select: { id: true, serialNumber: true, productId: true } });
    const sm = new Map(serials.map((s) => [s.id, s]));
    const foundIds = new Set(found.map((f) => f.serialId).filter(Boolean));
    const expectedIds = new Set(expected.map((e) => e.serialId));
    const lastMovement = async (serialId: string) => {
      const m = await this.prisma.inventoryMovement.findFirst({ where: { tenantId, serialId }, orderBy: { createdAt: 'desc' } });
      return m ? { movementType: m.movementType, sourceDocumentType: m.registrarDocumentType, sourceDocumentId: m.registrarDocumentId, date: m.effectiveDate, locationId: m.locationId } : null;
    };
    const rows = [];
    for (const e of expected) {
      rows.push({ serialNumber: sm.get(e.serialId!)?.serialNumber, productId: e.productId, expected: true, found: foundIds.has(e.serialId), status: foundIds.has(e.serialId) ? 'FOUND' : 'MISSING', locationId: e.locationId, lastKnownMovement: await lastMovement(e.serialId!) });
    }
    for (const f of found) {
      if (f.serialId && expectedIds.has(f.serialId)) continue;
      rows.push({ serialNumber: f.serialId ? sm.get(f.serialId)?.serialNumber : f.serialNumberText, productId: f.productId, expected: false, found: true, status: 'UNEXPECTED', locationId: f.locationId, lastKnownMovement: f.serialId ? await lastMovement(f.serialId) : null });
    }
    return {
      expected: rows.filter((r) => r.expected).length,
      found: rows.filter((r) => r.found).length,
      missing: rows.filter((r) => r.status === 'MISSING').map((r) => r.serialNumber),
      unexpected: rows.filter((r) => r.status === 'UNEXPECTED').map((r) => r.serialNumber),
      rows,
    };
  }

  /** Batch variance report (spec section 93). */
  async batchReport(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const lines = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, batchId: { not: null }, resolutionStatus: { not: 'SUPERSEDED' } } });
    const matches = await this.prisma.inventoryVarianceMatch.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, matchType: 'BATCH_MISMATCH' } });
    const decorated = await this.decorate(lines);
    return decorated.map((l: any) => this.redactRow({ ...l, potentialCrossBatchOffset: matches.filter((m) => m.shortageVarianceId === l.id || m.surplusVarianceId === l.id).reduce((s, m) => s.plus(dec(m.quantity)), new Decimal(0)).toString() }));
  }

  /** Location reconciliation with relocation suggestions (spec section 94). */
  async locationReport(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const matches = await this.prisma.inventoryVarianceMatch.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, matchType: 'LOCATION_MISMATCH' } });
    const ids = matches.flatMap((m) => [m.shortageVarianceId, m.surplusVarianceId]);
    const lines = await this.prisma.inventoryVariance.findMany({ where: { id: { in: ids } } });
    const decorated = new Map((await this.decorate(lines)).map((l: any) => [l.id, l]));
    return matches.map((m) => {
      const s: any = decorated.get(m.shortageVarianceId);
      const p: any = decorated.get(m.surplusVarianceId);
      return {
        productId: s?.productId,
        productCode: s?.productCode,
        fromLocation: s?.locationCode ?? s?.locationId,
        fromLocationShortage: dec(s?.quantityDifference).abs().toString(),
        toLocation: p?.locationCode ?? p?.locationId,
        toLocationSurplus: dec(p?.quantityDifference).toString(),
        potentialMatchingRelocation: m.quantity.toString(),
        suggestion: `Possible location mismatch: ${dec(m.quantity).toString()} units missing in ${s?.locationCode ?? 'n/a'} and ${dec(m.quantity).toString()} surplus in ${p?.locationCode ?? 'n/a'}.`,
        autoFix: 'Only through an approved LOCATION_TRANSFER decision',
      };
    });
  }

  /**
   * Phase 22 Month/Year Close integration (spec sections 62, 106):
   * `hasOpenInventoryCounts(period, organization)` and the counts that are
   * a mandatory dependency of closing that period.
   */
  async closeReadiness(tenantId: string, membershipId: string, organizationId: string, from: string, to: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.hasOpenInventoryCounts(tenantId, organizationId, new Date(from), new Date(to));
  }

  async hasOpenInventoryCounts(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const plans = await this.prisma.inventoryCountPlan.findMany({ where: { tenantId, organizationId, planDate: { gte: periodStart, lte: periodEnd }, status: { notIn: ['CLOSED', 'CANCELLED'] } } });
    const required = plans.filter((p) => p.mandatoryCloseDependency || p.yearEndCount);
    return {
      hasOpenInventoryCounts: plans.length > 0,
      inventoryCountRequiredForClose: required.length > 0,
      blocksClose: required.length > 0,
      openCounts: plans.map((p) => ({ planId: p.id, documentNumber: p.documentNumber, countType: p.countType, status: p.status, planDate: p.planDate, mandatoryCloseDependency: p.mandatoryCloseDependency, yearEndCount: p.yearEndCount })),
    };
  }

  /** Phase 30 accounting-health readiness data (spec section 107). */
  async health(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const open = await this.prisma.inventoryCountSession.findMany({ where: { tenantId, organizationId, status: { in: OPEN_SESSION_STATUSES } }, select: { id: true, sessionNumber: true, status: true, calculationVersion: true, approvedAt: true } });
    const approvedUnposted = open.filter((s) => s.status === 'APPROVED');
    const unreconciled = open.filter((s) => s.status === 'POSTED');
    const since = new Date(Date.now() - 365 * 86400000);
    const highShortages = await this.prisma.inventoryVariance.findMany({ where: { tenantId, organizationId, direction: 'SHORTAGE', severity: { in: ['HIGH', 'CRITICAL'] }, resolutionStatus: { in: ['APPROVED', 'POSTED'] }, createdAt: { gte: since } }, select: { id: true, sessionId: true, productId: true, warehouseId: true, quantityDifference: true, valueDifference: true, severity: true } });
    const serialMissing = await this.prisma.inventoryVariance.groupBy({ by: ['serialId'], where: { tenantId, organizationId, varianceType: 'SERIAL_MISSING', serialId: { not: null } }, _count: { _all: true } });
    const repeated = serialMissing.filter((s) => s._count._all > 1);
    return {
      openInventoryCounts: open.map((s) => ({ sessionId: s.id, sessionNumber: s.sessionNumber, status: s.status })),
      approvedButUnpostedVariances: approvedUnposted.map((s) => ({ sessionId: s.id, sessionNumber: s.sessionNumber, approvedAt: s.approvedAt })),
      unreconciledAdjustments: unreconciled.map((s) => ({ sessionId: s.id, sessionNumber: s.sessionNumber })),
      highShortages: highShortages.map((h) => ({ ...h, valueDifference: this.canSeeCost ? h.valueDifference : undefined })),
      repeatedSerialVariance: repeated.map((r) => ({ serialId: r.serialId, occurrences: r._count._all })),
    };
  }

  async auditHistory(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const plan = await this.sessions.loadPlan(tenantId, membershipId, organizationId, planId);
    const sessions = await this.prisma.inventoryCountSession.findMany({ where: { tenantId, planId: plan.id }, select: { id: true } });
    const docs = await this.prisma.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId: { in: sessions.map((s) => s.id) } }, select: { id: true } });
    const variances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: { in: sessions.map((s) => s.id) } }, select: { id: true } });
    return this.prisma.auditEvent.findMany({
      where: { tenantId, entityId: { in: [plan.id, ...sessions.map((s) => s.id), ...docs.map((d) => d.id), ...variances.map((v) => v.id)] } },
      orderBy: { timestamp: 'asc' },
      take: 1000,
    });
  }

  private async decorate(lines: any[]) {
    const ids = (f: string) => Array.from(new Set(lines.map((r) => r[f]).filter((x: string | null) => !!x))) as string[];
    const [products, locations, batches, warehouses] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids('productId') } }, select: { id: true, code: true, name: true } }),
      this.prisma.warehouseLocation.findMany({ where: { id: { in: ids('locationId') } }, select: { id: true, code: true } }),
      this.prisma.batch.findMany({ where: { id: { in: ids('batchId') } }, select: { id: true, batchNumber: true, expiryDate: true } }),
      this.prisma.warehouse.findMany({ where: { id: { in: ids('warehouseId') } }, select: { id: true, code: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const lm = new Map(locations.map((l) => [l.id, l.code]));
    const bm = new Map(batches.map((b) => [b.id, b]));
    const wm = new Map(warehouses.map((w) => [w.id, w.code]));
    return lines.map((l) => ({
      ...l,
      productCode: l.productId ? pm.get(l.productId)?.code : null,
      productName: l.productId ? pm.get(l.productId)?.name : null,
      locationCode: l.locationId ? lm.get(l.locationId) ?? null : null,
      batchNumber: l.batchId ? bm.get(l.batchId)?.batchNumber ?? null : null,
      expiryDate: l.batchId ? bm.get(l.batchId)?.expiryDate ?? null : null,
      warehouseCode: wm.get(l.warehouseId),
    }));
  }

  private redactRow<T extends Record<string, any>>(row: T): T {
    const out: Record<string, any> = { ...row };
    if (!this.canSeeCost) {
      delete out.unitCost;
      delete out.valueDifference;
      delete out.costSource;
      delete out.recoverableAmount;
    }
    if (!this.canSeeQty) {
      delete out.accountingQuantity;
      delete out.adjustedAccountingQuantity;
      delete out.postSnapshotInQuantity;
      delete out.postSnapshotOutQuantity;
      delete out.quantityDifference;
    }
    return out as T;
  }
}
