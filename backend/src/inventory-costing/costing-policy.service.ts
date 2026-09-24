import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface CostingPolicyInput {
  costingMethod?: 'FIFO' | 'WEIGHTED_AVERAGE';
  averageMethod?: 'MOVING_AVERAGE' | 'PERIODIC_WEIGHTED_AVERAGE';
  valuationCurrencyId?: string;
  includePurchaseAdditionalCosts?: boolean;
  includeCustomsCost?: boolean;
  includeFreight?: boolean;
  allowProvisionalCost?: boolean;
  allowNegativeQuantityCosting?: boolean;
  negativeStockCostPolicy?: 'LAST_KNOWN_COST' | 'CURRENT_AVERAGE' | 'STANDARD_COST' | 'ZERO_PENDING' | 'BLOCK_COSTING';
  recalculateBackdatedDocuments?: boolean;
  costByWarehouse?: boolean;
  costByCharacteristic?: boolean;
  costByBatch?: boolean;
  roundingPrecision?: number;
  consignmentIncludedInValuation?: boolean;
  effectiveFrom: string;
}

/**
 * InventoryCostingPolicyService (spec section 4) — effective-dated per
 * organization, same pattern as Phase 1's AccountingPolicy/TaxProfile
 * (`resolve(orgId, date)`). No costing policy configured for an
 * organization/date is a deliberate, disclosed "costing is not active
 * here yet" state — every caller in this module treats a `null` resolve
 * as "skip this costing event entirely," never fabricating a method or
 * silently defaulting to one (mirrors CostingService.getUnitCost's
 * existing null-means-unavailable convention from Sales Execution). This
 * also keeps every phase 0-10 e2e test that never configures a costing
 * policy completely unaffected by this module's existence.
 */
@Injectable()
export class CostingPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, organizationId: string) {
    return this.prisma.inventoryCostingPolicy.findMany({ where: { tenantId, organizationId }, orderBy: { effectiveFrom: 'desc' } });
  }

  /** Effective-dated resolve — the org's policy in force on `businessDate`,
   * or `null` when none has been configured yet. */
  async resolve(tenantId: string, organizationId: string, businessDate: Date, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.inventoryCostingPolicy.findFirst({
      where: {
        tenantId,
        organizationId,
        status: 'ACTIVE',
        effectiveFrom: { lte: businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * A method change is a NEW effective-dated row, never an in-place
   * mutation of the current one (spec sections 99-100: historical periods
   * must keep calculating under the policy that was active then). The
   * previous open-ended row (if any) has its `effectiveTo` closed off the
   * day before the new one starts.
   */
  async upsert(tenantId: string, organizationId: string, userId: string, input: CostingPolicyInput) {
    const effectiveFrom = this.parseDate(input.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const overlapping = await tx.inventoryCostingPolicy.findFirst({
        where: { tenantId, organizationId, status: 'ACTIVE', effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (overlapping) {
        const dayBefore = new Date(effectiveFrom);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        if (dayBefore < overlapping.effectiveFrom) {
          throw new ValidationAppError('New costing policy effective date must be after the current policy started');
        }
        await tx.inventoryCostingPolicy.update({ where: { id: overlapping.id }, data: { effectiveTo: dayBefore } });
      }

      const created = await tx.inventoryCostingPolicy.create({
        data: {
          tenantId,
          organizationId,
          effectiveFrom,
          costingMethod: input.costingMethod ?? 'WEIGHTED_AVERAGE',
          averageMethod: input.averageMethod ?? 'MOVING_AVERAGE',
          valuationCurrencyId: input.valuationCurrencyId,
          includePurchaseAdditionalCosts: input.includePurchaseAdditionalCosts ?? true,
          includeCustomsCost: input.includeCustomsCost ?? true,
          includeFreight: input.includeFreight ?? true,
          allowProvisionalCost: input.allowProvisionalCost ?? true,
          allowNegativeQuantityCosting: input.allowNegativeQuantityCosting ?? true,
          negativeStockCostPolicy: input.negativeStockCostPolicy ?? 'LAST_KNOWN_COST',
          recalculateBackdatedDocuments: input.recalculateBackdatedDocuments ?? true,
          costByWarehouse: input.costByWarehouse ?? true,
          costByCharacteristic: input.costByCharacteristic ?? false,
          costByBatch: input.costByBatch ?? false,
          roundingPrecision: input.roundingPrecision ?? 2,
          consignmentIncludedInValuation: input.consignmentIncludedInValuation ?? false,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'INVENTORY_COSTING_POLICY_CHANGED',
          entityType: 'InventoryCostingPolicy',
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { costingMethod: created.costingMethod, averageMethod: created.averageMethod, effectiveFrom: input.effectiveFrom },
          oldValues: overlapping ? { previousPolicyId: overlapping.id, previousCostingMethod: overlapping.costingMethod } : undefined,
        },
        tx,
      );

      return created;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid effective date');
    return date;
  }
}
