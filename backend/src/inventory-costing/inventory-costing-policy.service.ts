import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AuditService } from '../audit/audit.service';

export interface EffectiveCostingPolicy {
  id: string;
  costingMethod: string;
  averageMethod: string;
  valuationCurrencyId: string | null;
  includePurchaseAdditionalCosts: boolean;
  includeCustomsCost: boolean;
  includeFreight: boolean;
  allowProvisionalCost: boolean;
  allowNegativeQuantityCosting: boolean;
  negativeStockCostPolicy: string;
  recalculateBackdatedDocuments: boolean;
  costByWarehouse: boolean;
  costByCharacteristic: boolean;
  costByBatch: boolean;
  roundingPolicy: string;
}

/** Hardcoded fallback used only when a tenant/organization has never
 * configured a costing policy (spec section 75/99 both assume ONE always
 * resolves) — never used to silently override an explicitly configured
 * policy. Chosen to match this codebase's own conservative defaults
 * elsewhere: FIFO, warehouse-level costing, negative stock costed at the
 * last known cost rather than blocked. */
const DEFAULT_POLICY: EffectiveCostingPolicy = {
  id: 'default',
  costingMethod: 'FIFO',
  averageMethod: 'MOVING_AVERAGE',
  valuationCurrencyId: null,
  includePurchaseAdditionalCosts: true,
  includeCustomsCost: true,
  includeFreight: true,
  allowProvisionalCost: true,
  allowNegativeQuantityCosting: true,
  negativeStockCostPolicy: 'LAST_KNOWN_COST',
  recalculateBackdatedDocuments: true,
  costByWarehouse: true,
  costByCharacteristic: false,
  costByBatch: false,
  roundingPolicy: 'LINE_LEVEL_2DP',
};

/**
 * InventoryCostingPolicyService (spec sections 4, 87, 99-100). Resolution
 * is effective-dated: `resolve` picks the row whose
 * [effectiveFrom, effectiveTo) window covers `businessDate`, never "the
 * current row" — so a historical recalculation always re-applies the
 * method that was actually in force on that date, even after the policy
 * has since changed (spec section 99: never silently reinterpret history).
 */
@Injectable()
export class InventoryCostingPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async resolve(tenantId: string, organizationId: string, businessDate: Date, client?: PrismaTransactionClient): Promise<EffectiveCostingPolicy> {
    const db = client ?? this.prisma;
    const row = await db.inventoryCostingPolicy.findFirst({
      where: {
        tenantId,
        organizationId,
        status: 'ACTIVE',
        effectiveFrom: { lte: businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return DEFAULT_POLICY;
    return {
      id: row.id,
      costingMethod: row.costingMethod,
      averageMethod: row.averageMethod,
      valuationCurrencyId: row.valuationCurrencyId,
      includePurchaseAdditionalCosts: row.includePurchaseAdditionalCosts,
      includeCustomsCost: row.includeCustomsCost,
      includeFreight: row.includeFreight,
      allowProvisionalCost: row.allowProvisionalCost,
      allowNegativeQuantityCosting: row.allowNegativeQuantityCosting,
      negativeStockCostPolicy: row.negativeStockCostPolicy,
      recalculateBackdatedDocuments: row.recalculateBackdatedDocuments,
      costByWarehouse: row.costByWarehouse,
      costByCharacteristic: row.costByCharacteristic,
      costByBatch: row.costByBatch,
      roundingPolicy: row.roundingPolicy,
    };
  }

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryCostingPolicy.findMany({ where: { tenantId, organizationId }, orderBy: { effectiveFrom: 'desc' } });
  }

  /**
   * Creates a new effective-dated policy row. A method change mid-period
   * is blocked by default (spec section 100: "Period ortasında costing
   * method change default olaraq bloklana bilər") unless
   * `allowMidPeriodChange` is explicitly set — the caller (an
   * administrator with ACCOUNTING_POLICY_MANAGE-equivalent access) is
   * making an informed exception, not this service guessing one.
   */
  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    input: {
      effectiveFrom: string;
      costingMethod: string;
      averageMethod?: string;
      valuationCurrencyId?: string;
      costByWarehouse?: boolean;
      costByBatch?: boolean;
      allowNegativeQuantityCosting?: boolean;
      negativeStockCostPolicy?: string;
      allowMidPeriodChange?: boolean;
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) throw new ValidationAppError('Invalid effectiveFrom date');
    if (effectiveFrom.getDate() !== 1 && !input.allowMidPeriodChange) {
      throw new ValidationAppError('A costing policy normally takes effect on the first day of a period — pass allowMidPeriodChange to override');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const previous = await tx.inventoryCostingPolicy.findFirst({ where: { tenantId, organizationId, status: 'ACTIVE', effectiveTo: null } });
      if (previous) {
        if (new Date(previous.effectiveFrom) >= effectiveFrom) {
          throw new ValidationAppError('New policy must be effective after the currently active one');
        }
        const dayBefore = new Date(effectiveFrom);
        dayBefore.setDate(dayBefore.getDate() - 1);
        await tx.inventoryCostingPolicy.update({ where: { id: previous.id }, data: { effectiveTo: dayBefore, status: 'SUPERSEDED' } });
      }

      const row = await tx.inventoryCostingPolicy.create({
        data: {
          tenantId,
          organizationId,
          effectiveFrom,
          costingMethod: input.costingMethod,
          averageMethod: input.averageMethod ?? 'MOVING_AVERAGE',
          valuationCurrencyId: input.valuationCurrencyId,
          costByWarehouse: input.costByWarehouse ?? true,
          costByBatch: input.costByBatch ?? false,
          allowNegativeQuantityCosting: input.allowNegativeQuantityCosting ?? true,
          negativeStockCostPolicy: input.negativeStockCostPolicy ?? 'LAST_KNOWN_COST',
          status: 'ACTIVE',
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'INVENTORY_COSTING_POLICY_CHANGED',
          entityType: 'INVENTORY_COSTING_POLICY',
          entityId: row.id,
          action: 'CREATE',
          userId,
          oldValues: previous ? { costingMethod: previous.costingMethod, effectiveTo: null } : undefined,
          newValues: { costingMethod: row.costingMethod, effectiveFrom: row.effectiveFrom },
        },
        tx,
      );

      return row;
    });
  }
}
