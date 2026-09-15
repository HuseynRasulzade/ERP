import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCostingPolicyService } from '../inventory-costing/inventory-costing-policy.service';
import { CostingDimensionService } from '../inventory-costing/costing-dimension.service';
import { InventoryRecountService } from './inventory-recount.service';

interface DimKey {
  warehouseId: string;
  locationId: string | null;
  productId: string;
  characteristicId: string | null;
  batchId: string | null;
  serialId: string | null;
  ownershipType: string;
  qualityStatus: string;
}

const TOLERANCE = new Decimal('0.000001');

/**
 * InventoryVarianceService (spec sections 31-36, 42-43, 63-66). The
 * central variance calculation engine — NEVER nets across dimensions
 * (spec section 33/135: product-level zero must not hide a batch/location
 * mismatch), always accounts for post-snapshot movements under the
 * session's own freeze/cutoff mode before comparing to the physical
 * count, and distinguishes an explicit zero count from an UNCOUNTED item
 * (spec sections 85-86).
 */
@Injectable()
export class InventoryVarianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly snapshot: InventorySnapshotService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly dimensions: CostingDimensionService,
    private readonly recounts: InventoryRecountService,
  ) {}

  async calculate(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
    if (!session.snapshotAt) throw new ValidationAppError('Cannot calculate variance before a snapshot exists');

    const plan = await this.prisma.inventoryCountPlan.findFirstOrThrow({ where: { id: session.planId } });
    const snapshotLines = await this.prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId, snapshotVersion: session.snapshotVersion } });
    const entries = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId }, orderBy: { entryVersion: 'asc' } });
    const supersededIds = new Set(entries.map((e) => e.supersedesEntryId).filter(Boolean));
    const currentEntries = entries.filter((e) => !supersededIds.has(e.id));

    const keyOf = (d: DimKey) => [d.warehouseId, d.locationId, d.productId, d.characteristicId, d.batchId, d.serialId, d.ownershipType, d.qualityStatus].map((v) => v ?? '-').join('|');

    const snapshotByKey = new Map<string, { line: (typeof snapshotLines)[number]; key: DimKey }>();
    for (const l of snapshotLines) {
      const key: DimKey = { warehouseId: l.warehouseId, locationId: l.locationId, productId: l.productId, characteristicId: l.characteristicId, batchId: l.batchId, serialId: l.serialId, ownershipType: l.ownershipType, qualityStatus: l.qualityStatus };
      snapshotByKey.set(keyOf(key), { line: l, key });
    }

    const physicalByKey = new Map<string, Decimal>();
    const keyRegistry = new Map<string, DimKey>();
    for (const e of currentEntries) {
      const key: DimKey = { warehouseId: e.warehouseId, locationId: e.locationId, productId: e.productId, characteristicId: e.characteristicId, batchId: e.batchId, serialId: e.serialId, ownershipType: 'OWN', qualityStatus: 'AVAILABLE' };
      const k = keyOf(key);
      physicalByKey.set(k, (physicalByKey.get(k) ?? new Decimal(0)).plus(e.baseQuantity.toString()));
      keyRegistry.set(k, key);
    }
    for (const [k, v] of snapshotByKey) keyRegistry.set(k, v.key);

    const allKeys = new Set([...snapshotByKey.keys(), ...physicalByKey.keys()]);
    const cutoff = session.countCutoffAt ?? new Date();
    const policy = await this.policies.resolve(tenantId, organizationId, cutoff);

    const results: { key: DimKey; accountingQuantity: Decimal; adjustedAccountingQuantity: Decimal; physicalQuantity: Decimal | null; quantityDifference: Decimal; varianceType: string }[] = [];

    for (const k of allKeys) {
      const key = keyRegistry.get(k)!;
      const snap = snapshotByKey.get(k);
      const accountingQuantity = snap ? new Decimal(snap.line.accountingQuantity.toString()) : new Decimal(0);

      let adjustedAccountingQuantity = accountingQuantity;
      if (session.freezePolicy !== 'HARD_FREEZE') {
        // Post-snapshot movement reconciliation (spec sections 14-15, 63).
        const delta = await this.snapshot.postSnapshotDelta(tenantId, { warehouseId: key.warehouseId, locationId: key.locationId, productId: key.productId, batchId: key.batchId, ownershipType: key.ownershipType, qualityStatus: key.qualityStatus }, session.snapshotAt!, cutoff);
        adjustedAccountingQuantity = accountingQuantity.plus(delta);
      }

      const physicalQuantity = physicalByKey.has(k) ? physicalByKey.get(k)! : null;
      const uncounted = physicalQuantity === null;
      const quantityDifference = uncounted ? new Decimal(0) : physicalQuantity!.minus(adjustedAccountingQuantity);

      let varianceType: string;
      if (uncounted) {
        varianceType = accountingQuantity.abs().lt(TOLERANCE) ? 'MATCH' : 'UNCOUNTED_ITEM';
      } else if (accountingQuantity.abs().lt(TOLERANCE) && physicalQuantity!.gt(0)) {
        varianceType = 'SURPLUS'; // spec section 84 — unexpected stock, investigate reason separately
      } else if (quantityDifference.abs().lt(TOLERANCE)) {
        varianceType = 'MATCH';
      } else if (quantityDifference.gt(0)) {
        varianceType = 'SURPLUS';
      } else {
        varianceType = 'SHORTAGE';
      }

      results.push({ key, accountingQuantity, adjustedAccountingQuantity, physicalQuantity, quantityDifference, varianceType });
    }

    return this.prisma.runInTransaction(async (tx) => {
      await tx.inventoryVariance.deleteMany({ where: { tenantId, sessionId } }); // recompute is idempotent — replaces the prior calculation run entirely

      let created = 0;
      for (const r of results) {
        if (r.varianceType === 'MATCH') continue; // spec test 115 — no variance row needed for an exact match

        const costingKey = this.dimensions.resolveKey(policy, { organizationId, productId: r.key.productId, warehouseId: r.key.warehouseId, batchId: r.key.batchId });
        const layerAgg = await tx.inventoryCostLayer.aggregate({ where: { tenantId, costingKey, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] } }, _sum: { remainingQuantity: true, currentRemainingValue: true } });
        const layerQty = new Decimal((layerAgg._sum.remainingQuantity ?? 0).toString());
        const layerValue = new Decimal((layerAgg._sum.currentRemainingValue ?? 0).toString());
        const unitCost = layerQty.gt(0) ? layerValue.div(layerQty) : null;
        const valueDifference = unitCost ? unitCost.mul(r.quantityDifference).toDecimalPlaces(2) : null;

        const severity = this.classifySeverity(plan, r.quantityDifference, valueDifference);
        const resolutionStatus = this.needsRecount(plan, r.quantityDifference, valueDifference, r.accountingQuantity) ? 'RECOUNT_REQUIRED' : 'OPEN';

        await tx.inventoryVariance.create({
          data: {
            tenantId,
            sessionId,
            warehouseId: r.key.warehouseId,
            locationId: r.key.locationId,
            productId: r.key.productId,
            characteristicId: r.key.characteristicId,
            batchId: r.key.batchId,
            serialId: r.key.serialId,
            ownershipType: r.key.ownershipType,
            qualityStatus: r.key.qualityStatus,
            accountingQuantity: r.accountingQuantity.toString(),
            adjustedAccountingQuantity: r.adjustedAccountingQuantity.toString(),
            physicalQuantity: r.physicalQuantity?.toString(),
            quantityDifference: r.quantityDifference.toString(),
            varianceType: r.varianceType,
            unitCost: unitCost?.toString(),
            valueDifference: valueDifference?.toString(),
            severity,
            resolutionStatus,
          },
        });
        created++;
      }

      await this.detectSerialMismatches(tenantId, sessionId, snapshotLines, currentEntries, tx);

      await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: results.some((r) => r.varianceType === 'UNCOUNTED_ITEM') ? session.status : (session.status === 'COUNTING' ? 'UNDER_REVIEW' : session.status), reconciliationStatus: created > 0 ? 'DIFFERENCES_FOUND' : 'BALANCED' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_CALCULATED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'UPDATE', userId, newValues: { varianceCount: created } }, tx);

      return tx.inventoryVariance.findMany({ where: { tenantId, sessionId } });
    });
  }

  /** Serial variance (spec sections 24, 92, 122) — computed independently
   * of the quantity-only pass above: expected serial set (from the
   * snapshot) vs found serial set (from entries), per product/warehouse.
   * A net-zero quantity difference never hides a serial swap. */
  private async detectSerialMismatches(tenantId: string, sessionId: string, snapshotLines: { productId: string; warehouseId: string; serialId: string | null; accountingQuantity: unknown }[], entries: { productId: string; warehouseId: string; serialId: string | null }[], tx: PrismaTransactionClient) {
    const expectedBy = new Map<string, Set<string>>();
    for (const l of snapshotLines) {
      if (!l.serialId) continue;
      const key = `${l.warehouseId}|${l.productId}`;
      if (!expectedBy.has(key)) expectedBy.set(key, new Set());
      expectedBy.get(key)!.add(l.serialId);
    }
    const foundBy = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!e.serialId) continue;
      const key = `${e.warehouseId}|${e.productId}`;
      if (!foundBy.has(key)) foundBy.set(key, new Set());
      foundBy.get(key)!.add(e.serialId);
    }

    const allKeys = new Set([...expectedBy.keys(), ...foundBy.keys()]);
    for (const key of allKeys) {
      const [warehouseId, productId] = key.split('|');
      const expected = expectedBy.get(key) ?? new Set();
      const found = foundBy.get(key) ?? new Set();

      for (const serialId of expected) {
        if (!found.has(serialId)) {
          await tx.inventoryVariance.create({ data: { tenantId, sessionId, warehouseId, productId, serialId, accountingQuantity: '1', adjustedAccountingQuantity: '1', physicalQuantity: '0', quantityDifference: '-1', varianceType: 'SERIAL_MISSING', severity: 'WARNING', resolutionStatus: 'OPEN' } });
        }
      }
      for (const serialId of found) {
        if (!expected.has(serialId)) {
          await tx.inventoryVariance.create({ data: { tenantId, sessionId, warehouseId, productId, serialId, accountingQuantity: '0', adjustedAccountingQuantity: '0', physicalQuantity: '1', quantityDifference: '1', varianceType: 'SERIAL_UNEXPECTED', severity: 'WARNING', resolutionStatus: 'OPEN' } });
        }
      }
    }
  }

  private classifySeverity(plan: { recountValueThreshold: unknown }, quantityDifference: Decimal, valueDifference: Decimal | null): string {
    if (valueDifference && plan.recountValueThreshold && valueDifference.abs().gte(new Decimal(plan.recountValueThreshold.toString()).mul(5))) return 'CRITICAL';
    if (valueDifference && plan.recountValueThreshold && valueDifference.abs().gte(plan.recountValueThreshold.toString())) return 'WARNING';
    return 'NORMAL';
  }

  private needsRecount(plan: { recountPolicy: string; recountQuantityThreshold: unknown; recountValueThreshold: unknown; recountPercentageThreshold: unknown }, quantityDifference: Decimal, valueDifference: Decimal | null, accountingQuantity: Decimal): boolean {
    switch (plan.recountPolicy) {
      case 'NO_RECOUNT':
        return false;
      case 'RECOUNT_ALL_VARIANCES':
        return true;
      case 'RECOUNT_ABOVE_QUANTITY_THRESHOLD':
        return plan.recountQuantityThreshold != null && quantityDifference.abs().gt(plan.recountQuantityThreshold.toString());
      case 'RECOUNT_ABOVE_VALUE_THRESHOLD':
        return valueDifference != null && plan.recountValueThreshold != null && valueDifference.abs().gt(plan.recountValueThreshold.toString());
      case 'RECOUNT_PERCENTAGE':
        return plan.recountPercentageThreshold != null && accountingQuantity.gt(0) && quantityDifference.abs().div(accountingQuantity).mul(100).gt(plan.recountPercentageThreshold.toString());
      case 'MANUAL_SELECTION':
      default:
        return false;
    }
  }
}
