import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CountScopeMissingError } from './inventory-count.errors';
import { ScopeRuleDto } from './dto/inventory-count.dto';

export interface ScopeRow {
  warehouseId: string;
  locationId?: string | null;
  productId?: string | null;
  batchId?: string | null;
  serialId?: string | null;
  ownershipType?: string | null;
  stockStatus?: string | null;
}

/** Scope rules resolved once into id sets (spec section 5) — every
 * consumer (snapshot, freeze, entry validation, variance engine) asks the
 * same `matches` question instead of re-interpreting raw rules. */
export class ResolvedScope {
  constructor(
    readonly warehouseIds: string[],
    readonly locationInclude: Set<string> | null,
    readonly locationExclude: Set<string>,
    readonly productInclude: Set<string> | null,
    readonly productExclude: Set<string>,
    readonly batchInclude: Set<string> | null,
    readonly batchExclude: Set<string>,
    readonly serialInclude: Set<string> | null,
    readonly serialExclude: Set<string>,
    readonly ownershipInclude: Set<string> | null,
    readonly ownershipExclude: Set<string>,
    readonly statusInclude: Set<string> | null,
    readonly statusExclude: Set<string>,
  ) {}

  private static check(value: string | null | undefined, include: Set<string> | null, exclude: Set<string>): boolean {
    if (include && (!value || !include.has(value))) return false;
    if (value && exclude.has(value)) return false;
    return true;
  }

  matches(row: ScopeRow, opts: { ignoreProduct?: boolean } = {}): boolean {
    if (!this.warehouseIds.includes(row.warehouseId)) return false;
    if (!ResolvedScope.check(row.locationId, this.locationInclude, this.locationExclude)) return false;
    if (!opts.ignoreProduct && !ResolvedScope.check(row.productId, this.productInclude, this.productExclude)) return false;
    if (!ResolvedScope.check(row.batchId, this.batchInclude, this.batchExclude)) return false;
    if (!ResolvedScope.check(row.serialId, this.serialInclude, this.serialExclude)) return false;
    if (!ResolvedScope.check(row.ownershipType ?? 'OWN', this.ownershipInclude, this.ownershipExclude)) return false;
    if (!ResolvedScope.check(row.stockStatus ?? 'AVAILABLE', this.statusInclude, this.statusExclude)) return false;
    return true;
  }

  /** Prisma pre-filter for set-based register queries (the remaining
   * dimensions are checked in memory via `matches`). */
  movementWhere() {
    return {
      warehouseId: { in: this.warehouseIds },
      ...(this.productInclude ? { productId: { in: Array.from(this.productInclude) } } : {}),
    };
  }

  toJSON() {
    const arr = (s: Set<string> | null) => (s ? Array.from(s) : null);
    return {
      warehouseIds: this.warehouseIds,
      locationInclude: arr(this.locationInclude),
      locationExclude: Array.from(this.locationExclude),
      productInclude: arr(this.productInclude),
      productExclude: Array.from(this.productExclude),
      batchInclude: arr(this.batchInclude),
      serialInclude: arr(this.serialInclude),
      ownershipInclude: arr(this.ownershipInclude),
      statusInclude: arr(this.statusInclude),
    };
  }
}

/**
 * InventoryCountScopeService (spec sections 5-6). Scope rules live in
 * `InventoryCountScope` rows; a revision number is bumped on every change
 * so a session can record which revision it counted against.
 */
@Injectable()
export class InventoryCountScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async activeRules(tenantId: string, planId: string, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    return db.inventoryCountScope.findMany({ where: { tenantId, planId, active: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Validates every referenced id belongs to this organization — a
   * scope can never reach into another org/tenant's stock. */
  async validateRules(tenantId: string, organizationId: string, rules: ScopeRuleDto[], tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    for (const rule of rules) {
      const id = rule.valueId;
      let ok = true;
      switch (rule.dimension) {
        case 'WAREHOUSE':
          ok = !!(await db.warehouse.findFirst({ where: { id, organizationId, tenantId } }));
          break;
        case 'BRANCH':
          ok = !!(await db.branch.findFirst({ where: { id, organizationId } }));
          break;
        case 'LOCATION':
        case 'LOCATION_SUBTREE':
          ok = !!(await db.warehouseLocation.findFirst({ where: { id, tenantId, warehouse: { organizationId } } }));
          break;
        case 'PRODUCT':
          ok = !!(await db.product.findFirst({ where: { id, organizationId, tenantId } }));
          break;
        case 'PRODUCT_CATEGORY':
          ok = !!(await db.productCategory.findFirst({ where: { id, organizationId, tenantId } }));
          break;
        case 'BATCH':
          ok = !!(await db.batch.findFirst({ where: { id, organizationId, tenantId } }));
          break;
        case 'SERIAL':
          ok = !!(await db.serialNumber.findFirst({ where: { id, organizationId, tenantId } }));
          break;
        default:
          ok = true;
      }
      if (!ok) throw new ValidationAppError(`Scope ${rule.dimension} value ${id} does not belong to this organization`);
    }
  }

  /** Replaces the plan's scope with a new revision (old rows are kept,
   * `active=false`, for audit). Returns the new revision number. */
  async replaceRules(tenantId: string, planId: string, rules: ScopeRuleDto[], userId: string, tx: PrismaTransactionClient): Promise<number> {
    const latest = await tx.inventoryCountScope.findFirst({ where: { tenantId, planId }, orderBy: { revision: 'desc' } });
    const revision = (latest?.revision ?? 0) + 1;
    await tx.inventoryCountScope.updateMany({ where: { tenantId, planId, active: true }, data: { active: false } });
    for (const rule of rules) {
      await tx.inventoryCountScope.create({
        data: { tenantId, planId, ruleType: rule.ruleType ?? 'INCLUDE', dimension: rule.dimension, valueId: rule.valueId, revision, createdBy: userId },
      });
    }
    return revision;
  }

  async resolve(tenantId: string, organizationId: string, planId: string, tx?: PrismaTransactionClient): Promise<ResolvedScope> {
    const db = tx ?? this.prisma;
    const rules = await this.activeRules(tenantId, planId, tx);
    if (rules.length === 0) throw new CountScopeMissingError();

    const inc = (dims: string[]) => rules.filter((r) => r.ruleType === 'INCLUDE' && dims.includes(r.dimension)).map((r) => r.valueId);
    const exc = (dims: string[]) => rules.filter((r) => r.ruleType === 'EXCLUDE' && dims.includes(r.dimension)).map((r) => r.valueId);
    const setOrNull = (ids: string[]) => (ids.length > 0 ? new Set(ids) : null);

    // Locations (exact + subtree).
    const expandSubtree = async (rootIds: string[]) => {
      const out = new Set<string>(rootIds);
      let frontier = rootIds;
      while (frontier.length > 0) {
        const children = await db.warehouseLocation.findMany({ where: { tenantId, parentLocationId: { in: frontier } }, select: { id: true } });
        frontier = children.map((c) => c.id).filter((id) => !out.has(id));
        frontier.forEach((id) => out.add(id));
      }
      return out;
    };
    const locIncExact = inc(['LOCATION']);
    const locIncTree = inc(['LOCATION_SUBTREE']);
    let locationInclude: Set<string> | null = null;
    if (locIncExact.length + locIncTree.length > 0) {
      locationInclude = new Set([...locIncExact, ...(await expandSubtree(locIncTree))]);
    }
    const locationExclude = new Set([...exc(['LOCATION']), ...(await expandSubtree(exc(['LOCATION_SUBTREE'])))]);

    // Warehouses.
    const warehouseSet = new Set<string>(inc(['WAREHOUSE']));
    const branchIds = inc(['BRANCH']);
    if (branchIds.length > 0) {
      const whs = await db.warehouse.findMany({ where: { tenantId, organizationId, branchId: { in: branchIds }, active: true }, select: { id: true } });
      whs.forEach((w) => warehouseSet.add(w.id));
    }
    if (locationInclude && locationInclude.size > 0) {
      const locs = await db.warehouseLocation.findMany({ where: { tenantId, id: { in: Array.from(locationInclude) } }, select: { warehouseId: true } });
      locs.forEach((l) => warehouseSet.add(l.warehouseId));
    }
    if (warehouseSet.size === 0) {
      const whs = await db.warehouse.findMany({ where: { tenantId, organizationId, active: true }, select: { id: true } });
      whs.forEach((w) => warehouseSet.add(w.id));
    }
    exc(['WAREHOUSE']).forEach((id) => warehouseSet.delete(id));

    // Products (explicit + category subtree).
    const expandCategories = async (rootIds: string[]) => {
      const out = new Set<string>(rootIds);
      let frontier = rootIds;
      while (frontier.length > 0) {
        const children = await db.productCategory.findMany({ where: { tenantId, parentCategoryId: { in: frontier } }, select: { id: true } });
        frontier = children.map((c) => c.id).filter((id) => !out.has(id));
        frontier.forEach((id) => out.add(id));
      }
      return Array.from(out);
    };
    const productsOfCategories = async (categoryIds: string[]) => {
      if (categoryIds.length === 0) return [];
      const cats = await expandCategories(categoryIds);
      const prods = await db.product.findMany({ where: { tenantId, organizationId, categoryId: { in: cats } }, select: { id: true } });
      return prods.map((p) => p.id);
    };
    const prodInc = [...inc(['PRODUCT']), ...(await productsOfCategories(inc(['PRODUCT_CATEGORY'])))];
    const productInclude = inc(['PRODUCT', 'PRODUCT_CATEGORY']).length > 0 ? new Set(prodInc) : null;
    const productExclude = new Set([...exc(['PRODUCT']), ...(await productsOfCategories(exc(['PRODUCT_CATEGORY'])))]);

    return new ResolvedScope(
      Array.from(warehouseSet),
      locationInclude,
      locationExclude,
      productInclude,
      productExclude,
      setOrNull(inc(['BATCH'])),
      new Set(exc(['BATCH'])),
      setOrNull(inc(['SERIAL'])),
      new Set(exc(['SERIAL'])),
      setOrNull(inc(['OWNERSHIP_TYPE'])),
      new Set(exc(['OWNERSHIP_TYPE'])),
      setOrNull(inc(['QUALITY_STATUS', 'INVENTORY_STATUS'])),
      new Set(exc(['QUALITY_STATUS', 'INVENTORY_STATUS'])),
    );
  }
}
