import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountSessionInvalidStateError, NotFoundAppError } from '../common/errors/app-error';
import { PHYSICAL_STOCK_STATUSES } from '../warehouse-inventory/inventory-movement.service';

const EPSILON = new Decimal('0.000001');
const OPEN_RESOLUTION_STATUSES = ['OPEN', 'RECOUNT_REQUIRED', 'UNDER_INVESTIGATION', 'EXPLAINED'];

interface Tuple {
  warehouseId: string;
  locationId: string | null;
  productId: string;
  batchId: string | null;
  ownershipType: string;
  qualityStatus: string;
}

interface AggRow extends Tuple {
  accountingQuantity: Decimal;
  adjustedAccountingQuantity: Decimal;
  physicalQuantity: Decimal | null;
  unitCost: Decimal | null;
  expectedSerialNumbers: Set<string>;
  foundSerialNumbers: Set<string>;
  serialIdByNumber: Map<string, string>;
}

function tupleKey(t: Tuple): string {
  return [t.warehouseId, t.locationId ?? '', t.productId, t.batchId ?? '', t.ownershipType, t.qualityStatus].join('::');
}

/**
 * InventoryVarianceService (spec sections 31-36, 42-47) — the central
 * comparison engine: NEVER a per-product net, always the full dimension
 * tuple (warehouse, location, product, batch, ownership, quality status),
 * so a Batch A -10 / Batch B +10 pair (spec section 33) stays two rows
 * even though the product-level net is zero. Serial identity (spec
 * section 24) is compared separately from quantity — a serial mismatch
 * survives even when the counted quantity matches exactly.
 *
 * Re-runnable while the session sits in UNDER_REVIEW/RECOUNT_REQUIRED:
 * rows already APPROVED/POSTED/REJECTED are left untouched (spec section
 * 47 — a decided variance is never silently overwritten by a refresh);
 * everything else (OPEN/RECOUNT_REQUIRED/UNDER_INVESTIGATION/EXPLAINED)
 * is recomputed from the current adjusted-accounting-quantity and
 * physical count.
 */
@Injectable()
export class InventoryVarianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);
    return this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId }, include: { decision: true }, orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, sessionId: string, varianceId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId }, include: { decision: true } });
    if (!row) throw new NotFoundAppError('InventoryVariance', varianceId);
    return row;
  }

  async calculate(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId }, include: { plan: true, sheets: true } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (!['UNDER_REVIEW', 'RECOUNT_REQUIRED'].includes(session.status)) {
        throw new CountSessionInvalidStateError('Variance can only be calculated once every count sheet is under review');
      }

      const rows = await this.buildAggregateRows(tx, tenantId, organizationId, session);
      const mismatchOverrides = this.classifyMismatches(rows);

      let anyRecountRequired = false;
      for (const row of rows.values()) {
        const written = await this.upsertQuantityVariance(tx, tenantId, sessionId, session.plan, row, userId, mismatchOverrides.get(tupleKey(row)));
        if (written?.recountRequired) anyRecountRequired = true;
      }
      for (const row of rows.values()) {
        // Serial mismatches (spec section 24) are recorded as their own
        // variance rows but never by themselves force a recount — recount
        // policy is driven by the quantity variance only.
        await this.upsertSerialVariances(tx, tenantId, sessionId, row, userId);
      }

      // No manual approval step is needed when every non-MATCH variance was
      // already auto-accepted (or there simply are none) — go straight to
      // APPROVED so a clean count reconciles/closes without an idle
      // PENDING_APPROVAL step nobody needs to act on.
      const unresolvedCount = await tx.inventoryVariance.count({
        where: { tenantId, sessionId, varianceType: { not: 'MATCH' }, resolutionStatus: { notIn: ['APPROVED', 'POSTED'] } },
      });
      const newStatus = anyRecountRequired ? 'RECOUNT_REQUIRED' : unresolvedCount === 0 ? 'APPROVED' : 'PENDING_APPROVAL';
      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: newStatus, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_CALCULATED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'UPDATE', userId, newValues: { tupleCount: rows.size, newStatus } }, tx);
      return updated;
    });
  }

  async changeReasonCode(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, varianceId: string, reasonCode: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const variance = await this.prisma.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId } });
    if (!variance) throw new NotFoundAppError('InventoryVariance', varianceId);
    const updated = await this.prisma.inventoryVariance.update({ where: { id: varianceId }, data: { reasonCode } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_REASON_CHANGED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: 'UPDATE', userId, oldValues: { reasonCode: variance.reasonCode }, newValues: { reasonCode } });
    return updated;
  }

  // --- internals -----------------------------------------------------

  private async buildAggregateRows(tx: PrismaTransactionClient, tenantId: string, organizationId: string, session: { id: string; snapshotAt: Date | null; countCutoffAt: Date | null; cutoffMode: string; sheets: { warehouseId: string; locationId: string | null; completedAt: Date | null }[] }) {
    const snapshotLines = await tx.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId: session.id } });
    const entries = await tx.inventoryCountEntry.findMany({ where: { tenantId, sessionId: session.id, voided: false }, include: { serials: true } });

    const cutoffByLocation = new Map<string, Date>();
    for (const sheet of session.sheets) {
      const key = `${sheet.warehouseId}::${sheet.locationId ?? ''}`;
      const cutoff = session.cutoffMode === 'GLOBAL_SNAPSHOT_CUTOFF' ? (session.countCutoffAt ?? new Date()) : (sheet.completedAt ?? session.countCutoffAt ?? new Date());
      cutoffByLocation.set(key, cutoff);
    }

    const rows = new Map<string, AggRow>();
    const ensure = (t: Tuple): AggRow => {
      const key = tupleKey(t);
      let row = rows.get(key);
      if (!row) {
        row = { ...t, accountingQuantity: new Decimal(0), adjustedAccountingQuantity: new Decimal(0), physicalQuantity: null, unitCost: null, expectedSerialNumbers: new Set(), foundSerialNumbers: new Set(), serialIdByNumber: new Map() };
        rows.set(key, row);
      }
      return row;
    };

    const serialIds = [...new Set(snapshotLines.map((l) => l.serialId).filter((s): s is string => !!s))];
    const serials = serialIds.length > 0 ? await tx.serialNumber.findMany({ where: { id: { in: serialIds }, tenantId } }) : [];
    const serialNumberById = new Map(serials.map((s) => [s.id, s.serialNumber]));

    for (const line of snapshotLines) {
      const row = ensure({ warehouseId: line.warehouseId, locationId: line.locationId, productId: line.productId, batchId: line.batchId, ownershipType: line.ownershipType, qualityStatus: line.qualityStatus });
      row.accountingQuantity = row.accountingQuantity.plus(line.accountingQuantity.toString());
      row.adjustedAccountingQuantity = row.adjustedAccountingQuantity.plus(line.accountingQuantity.toString());
      if (line.unitCost) row.unitCost = new Decimal(line.unitCost.toString());
      if (line.serialId) {
        const number = serialNumberById.get(line.serialId);
        if (number) {
          row.expectedSerialNumbers.add(number);
          row.serialIdByNumber.set(number, line.serialId);
        }
      }
    }

    // Post-snapshot movements within [snapshotAt, per-location cutoff] — only
    // within this session's own footprint (its sheets), so a warehouse/
    // location outside scope is never touched (spec section 125's own scope
    // isolation test).
    for (const sheet of session.sheets) {
      const key = `${sheet.warehouseId}::${sheet.locationId ?? ''}`;
      const cutoff = cutoffByLocation.get(key)!;
      const movements = await tx.inventoryMovement.groupBy({
        by: ['productId', 'batchId', 'ownershipType', 'stockStatus'],
        where: {
          tenantId,
          organizationId,
          warehouseId: sheet.warehouseId,
          locationId: sheet.locationId,
          stockStatus: { in: PHYSICAL_STOCK_STATUSES },
          effectiveDate: { gt: session.snapshotAt ?? new Date(0), lte: cutoff },
        },
        _sum: { baseQuantity: true },
      });
      for (const m of movements) {
        const row = ensure({ warehouseId: sheet.warehouseId, locationId: sheet.locationId, productId: m.productId, batchId: m.batchId, ownershipType: m.ownershipType, qualityStatus: m.stockStatus });
        row.adjustedAccountingQuantity = row.adjustedAccountingQuantity.plus((m._sum.baseQuantity ?? 0).toString());
      }
    }

    for (const entry of entries) {
      const row = ensure({ warehouseId: entry.warehouseId, locationId: entry.locationId, productId: entry.productId, batchId: entry.batchId, ownershipType: entry.ownershipType, qualityStatus: entry.qualityStatus });
      row.physicalQuantity = (row.physicalQuantity ?? new Decimal(0)).plus(entry.baseQuantity.toString());
      for (const s of entry.serials) row.foundSerialNumbers.add(s.serialNumber);
    }

    return rows;
  }

  private async upsertQuantityVariance(
    tx: PrismaTransactionClient,
    tenantId: string,
    sessionId: string,
    plan: {
      varianceQuantityTolerance: Decimal | null;
      varianceValueTolerance: Decimal | null;
      variancePercentageTolerance: Decimal | null;
      recountPolicy: string;
      recountQuantityThreshold: Decimal | null;
      recountValueThreshold: Decimal | null;
      recountPercentageThreshold: Decimal | null;
    },
    row: AggRow,
    userId: string,
    mismatchOverride?: 'LOCATION_MISMATCH' | 'BATCH_MISMATCH',
  ): Promise<{ recountRequired: boolean } | null> {
    const existing = await tx.inventoryVariance.findFirst({
      where: { tenantId, sessionId, warehouseId: row.warehouseId, locationId: row.locationId, productId: row.productId, batchId: row.batchId, ownershipType: row.ownershipType, qualityStatus: row.qualityStatus, serialId: null },
      include: { decision: true },
    });
    if (existing && !OPEN_RESOLUTION_STATUSES.includes(existing.resolutionStatus)) return { recountRequired: existing.recountRequired };

    const hasEntry = row.physicalQuantity !== null;
    const physicalQuantity = row.physicalQuantity;
    const quantityDifference = hasEntry ? physicalQuantity!.minus(row.adjustedAccountingQuantity) : new Decimal(0);
    const unitCost = row.unitCost;
    const valueDifference = unitCost ? quantityDifference.times(unitCost).toDecimalPlaces(2) : null;

    let varianceType: string;
    if (!hasEntry) {
      varianceType = row.adjustedAccountingQuantity.abs().gt(EPSILON) ? 'UNCOUNTED_ITEM' : 'MATCH';
    } else if (quantityDifference.abs().lte(EPSILON)) {
      varianceType = 'MATCH';
    } else {
      varianceType = mismatchOverride ?? (quantityDifference.gt(0) ? 'SURPLUS' : 'SHORTAGE');
    }

    if (varianceType === 'MATCH') {
      if (existing) return { recountRequired: false };
      // still write a MATCH row (spec section 31: variance TYPE enum
      // explicitly includes MATCH) so the variance report has full
      // per-tuple traceability, not just the exceptions.
    }

    const tolerance = this.withinTolerance(quantityDifference, valueDifference, row.adjustedAccountingQuantity, plan);
    const severity = varianceType === 'MATCH' || varianceType === 'UNCOUNTED_ITEM' ? 'NORMAL' : tolerance ? 'NORMAL' : quantityDifference.abs().gt(row.adjustedAccountingQuantity.abs().times(0.2)) ? 'CRITICAL' : 'WARNING';
    const recountRequired = varianceType !== 'MATCH' && varianceType !== 'UNCOUNTED_ITEM' && !tolerance && this.needsRecount(quantityDifference, valueDifference, row.adjustedAccountingQuantity, plan);

    const data = {
      accountingQuantity: row.accountingQuantity.toString(),
      adjustedAccountingQuantity: row.adjustedAccountingQuantity.toString(),
      physicalQuantity: hasEntry ? physicalQuantity!.toString() : null,
      quantityDifference: quantityDifference.toString(),
      varianceType,
      unitCost: unitCost ? unitCost.toString() : null,
      valueDifference: valueDifference ? valueDifference.toString() : null,
      severity,
      recountRequired,
    };

    let varianceId: string;
    if (existing) {
      await tx.inventoryVariance.update({ where: { id: existing.id }, data: { ...data, resolutionStatus: recountRequired ? 'RECOUNT_REQUIRED' : existing.resolutionStatus === 'RECOUNT_REQUIRED' ? 'OPEN' : existing.resolutionStatus } });
      varianceId = existing.id;
    } else {
      const created = await tx.inventoryVariance.create({
        data: { tenantId, sessionId, warehouseId: row.warehouseId, locationId: row.locationId, productId: row.productId, batchId: row.batchId, ownershipType: row.ownershipType, qualityStatus: row.qualityStatus, resolutionStatus: recountRequired ? 'RECOUNT_REQUIRED' : 'OPEN', ...data },
      });
      varianceId = created.id;
    }

    if (varianceType !== 'MATCH' && varianceType !== 'UNCOUNTED_ITEM' && tolerance && !existing?.decision) {
      // Auto-accept small variance (spec section 43) — still audited, never silent.
      await tx.inventoryVarianceDecision.upsert({
        where: { varianceId },
        create: { tenantId, varianceId, finalPhysicalQuantity: (physicalQuantity ?? new Decimal(0)).toString(), acceptedDifference: quantityDifference.toString(), resolutionType: 'NO_ADJUSTMENT', reasonCode: 'other', approver: 'system', approvedAt: new Date(), status: 'APPROVED', comment: 'Auto-accepted: within configured variance tolerance' },
        update: {},
      });
      await tx.inventoryVariance.update({ where: { id: varianceId }, data: { resolutionStatus: 'APPROVED' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_AUTO_ACCEPTED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: 'CREATE', userId, newValues: data }, tx);
    }

    return { recountRequired };
  }

  private async upsertSerialVariances(tx: PrismaTransactionClient, tenantId: string, sessionId: string, row: AggRow, userId: string): Promise<boolean> {
    if (row.expectedSerialNumbers.size === 0 && row.foundSerialNumbers.size === 0) return false;
    let any = false;

    const missing = [...row.expectedSerialNumbers].filter((n) => !row.foundSerialNumbers.has(n));
    const unexpected = [...row.foundSerialNumbers].filter((n) => !row.expectedSerialNumbers.has(n));

    for (const number of missing) {
      any = true;
      const serialId = row.serialIdByNumber.get(number) ?? null;
      const existing = await tx.inventoryVariance.findFirst({ where: { tenantId, sessionId, warehouseId: row.warehouseId, locationId: row.locationId, productId: row.productId, batchId: row.batchId, serialId } });
      if (existing && !OPEN_RESOLUTION_STATUSES.includes(existing.resolutionStatus)) continue;
      const data = { varianceType: 'SERIAL_MISSING', accountingQuantity: '1', adjustedAccountingQuantity: '1', physicalQuantity: '0', quantityDifference: '-1', severity: 'WARNING' as const, ownershipType: row.ownershipType, qualityStatus: row.qualityStatus };
      if (existing) await tx.inventoryVariance.update({ where: { id: existing.id }, data });
      else await tx.inventoryVariance.create({ data: { tenantId, sessionId, warehouseId: row.warehouseId, locationId: row.locationId, productId: row.productId, batchId: row.batchId, serialId, resolutionStatus: 'OPEN', ...data } });
    }

    for (const number of unexpected) {
      any = true;
      const foundSerial = await tx.serialNumber.findFirst({ where: { tenantId, serialNumber: number, productId: row.productId } });
      const existing = await tx.inventoryVariance.findFirst({ where: { tenantId, sessionId, warehouseId: row.warehouseId, locationId: row.locationId, productId: row.productId, batchId: row.batchId, serialId: foundSerial?.id ?? null, varianceType: 'SERIAL_UNEXPECTED' } });
      if (existing && !OPEN_RESOLUTION_STATUSES.includes(existing.resolutionStatus)) continue;
      const data = { varianceType: 'SERIAL_UNEXPECTED', accountingQuantity: '0', adjustedAccountingQuantity: '0', physicalQuantity: '1', quantityDifference: '1', severity: 'WARNING' as const, ownershipType: row.ownershipType, qualityStatus: row.qualityStatus };
      if (existing) await tx.inventoryVariance.update({ where: { id: existing.id }, data });
      else await tx.inventoryVariance.create({ data: { tenantId, sessionId, warehouseId: row.warehouseId, locationId: row.locationId, productId: row.productId, batchId: row.batchId, serialId: foundSerial?.id ?? null, resolutionStatus: 'OPEN', ...data } });
    }

    if (any) {
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SERIAL_VARIANCE_DETECTED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'CREATE', userId, newValues: { productId: row.productId, missing: missing.length, unexpected: unexpected.length } }, tx);
    }
    return any;
  }

  /**
   * Detects a pure redistribution (spec sections 26-27, 33, 94, 120-121):
   * within the same product+warehouse, ≥2 dimension rows (location or
   * batch) carry a nonzero physical/adjusted-accounting difference whose
   * NET sums to ~zero. Individually those rows would read as an
   * unremarkable SURPLUS/SHORTAGE pair that cancels out; tagging them
   * LOCATION_MISMATCH/BATCH_MISMATCH instead makes sure the discrepancy is
   * never silently netted away (a real net difference — the sum does NOT
   * cancel — is left as ordinary SURPLUS/SHORTAGE on each row).
   */
  private classifyMismatches(rows: Map<string, AggRow>): Map<string, 'LOCATION_MISMATCH' | 'BATCH_MISMATCH'> {
    const result = new Map<string, 'LOCATION_MISMATCH' | 'BATCH_MISMATCH'>();
    const byProduct = new Map<string, AggRow[]>();
    for (const row of rows.values()) {
      const key = `${row.warehouseId}::${row.productId}`;
      const arr = byProduct.get(key) ?? [];
      arr.push(row);
      byProduct.set(key, arr);
    }

    for (const group of byProduct.values()) {
      const withDiff = group.filter((r) => r.physicalQuantity !== null && r.physicalQuantity.minus(r.adjustedAccountingQuantity).abs().gt(EPSILON));
      if (withDiff.length < 2) continue;
      const netSum = withDiff.reduce((s, r) => s.plus(r.physicalQuantity!.minus(r.adjustedAccountingQuantity)), new Decimal(0));
      if (netSum.abs().gt(EPSILON)) continue;

      const distinctLocations = new Set(withDiff.map((r) => r.locationId ?? ''));
      const distinctBatches = new Set(withDiff.map((r) => r.batchId ?? ''));
      const type: 'LOCATION_MISMATCH' | 'BATCH_MISMATCH' | null = distinctLocations.size >= 2 ? 'LOCATION_MISMATCH' : distinctBatches.size >= 2 ? 'BATCH_MISMATCH' : null;
      if (type) for (const r of withDiff) result.set(tupleKey(r), type);
    }
    return result;
  }

  private withinTolerance(
    diff: Decimal,
    valueDiff: Decimal | null,
    adjustedQty: Decimal,
    plan: { varianceQuantityTolerance: Decimal | null; varianceValueTolerance: Decimal | null; variancePercentageTolerance: Decimal | null },
  ): boolean {
    if (plan.varianceQuantityTolerance && diff.abs().lte(new Decimal(plan.varianceQuantityTolerance.toString()))) return true;
    if (plan.varianceValueTolerance && valueDiff && valueDiff.abs().lte(new Decimal(plan.varianceValueTolerance.toString()))) return true;
    if (plan.variancePercentageTolerance && adjustedQty.abs().gt(0)) {
      const pct = diff.abs().div(adjustedQty.abs()).times(100);
      if (pct.lte(new Decimal(plan.variancePercentageTolerance.toString()))) return true;
    }
    return false;
  }

  private needsRecount(
    diff: Decimal,
    valueDiff: Decimal | null,
    adjustedQty: Decimal,
    plan: { recountPolicy: string; recountQuantityThreshold: Decimal | null; recountValueThreshold: Decimal | null; recountPercentageThreshold: Decimal | null },
  ): boolean {
    switch (plan.recountPolicy) {
      case 'NO_RECOUNT':
      case 'NEVER_RECOUNT':
      case 'MANUAL_SELECTION':
        return false;
      case 'RECOUNT_ALL_VARIANCES':
      case 'ALWAYS_RECOUNT':
        return true;
      case 'RECOUNT_ABOVE_QUANTITY_THRESHOLD':
        return plan.recountQuantityThreshold ? diff.abs().gt(new Decimal(plan.recountQuantityThreshold.toString())) : true;
      case 'RECOUNT_ABOVE_VALUE_THRESHOLD':
        return plan.recountValueThreshold && valueDiff ? valueDiff.abs().gt(new Decimal(plan.recountValueThreshold.toString())) : diff.abs().gt(0);
      case 'RECOUNT_PERCENTAGE':
      case 'RECOUNT_ABOVE_PERCENTAGE_THRESHOLD':
        if (!plan.recountPercentageThreshold || adjustedQty.abs().lte(0)) return diff.abs().gt(0);
        return diff.abs().div(adjustedQty.abs()).times(100).gt(new Decimal(plan.recountPercentageThreshold.toString()));
      default:
        return false;
    }
  }

  private async assertSessionInOrg(tenantId: string, organizationId: string, sessionId: string) {
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
    return session;
  }
}
