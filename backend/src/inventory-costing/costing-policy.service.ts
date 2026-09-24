import { Injectable } from '@nestjs/common';
import { InventoryCostingPolicy } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { InventoryCostingPolicyInvalidError, NotFoundAppError } from '../common/errors/app-error';
import {
  AverageMethods,
  CostingMethods,
  NegativeStockCostPolicies,
  SalesReturnWithoutSourcePolicies,
  UnpostDependencyPolicies,
  isoDate,
  toDateOnly,
} from './costing.types';

export interface CreateCostingPolicyInput {
  effectiveFrom: string;
  costingMethod: string;
  averageMethod?: string;
  valuationCurrencyId?: string;
  costByWarehouse?: boolean;
  costByBatch?: boolean;
  financialOwnershipTypes?: string[];
  negativeStockCostPolicy?: string;
  salesReturnWithoutSourceCost?: string;
  unpostDependencyPolicy?: string;
  recalculateBackdatedDocuments?: boolean;
  allowNegativeQuantityCosting?: boolean;
  reconciliationTolerance?: string;
}

/**
 * InventoryCostingPolicyService (spec sections 4, 99-100). Costing is
 * opt-in per organization: an organization with no ACTIVE policy
 * covering a date is simply not costed (the pre-Phase-11 behaviour every
 * existing document flow keeps), never silently costed with a hard-coded
 * default method.
 *
 * Method changes are effective-dated and must start on a period (month)
 * boundary after the last finalized costing period (spec 99-100) —
 * historical periods keep their original method. Costing dimensions
 * (by-warehouse / by-batch) are frozen once any cost movement exists:
 * changing them re-keys the whole history, which is a migration
 * procedure, not a policy edit.
 */
@Injectable()
export class InventoryCostingPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mappings: AccountingMappingService,
  ) {}

  list(tenantId: string, organizationId: string) {
    return this.prisma.inventoryCostingPolicy.findMany({ where: { tenantId, organizationId }, orderBy: { effectiveFrom: 'asc' } });
  }

  /** All ACTIVE policies of the organization, ascending — the engine
   * resolves a per-movement policy from this list (no N+1 per movement). */
  async loadPolicies(tenantId: string, organizationId: string, tx?: PrismaTransactionClient): Promise<InventoryCostingPolicy[]> {
    const db = tx ?? this.prisma;
    return db.inventoryCostingPolicy.findMany({ where: { tenantId, organizationId, status: 'ACTIVE' }, orderBy: { effectiveFrom: 'asc' } });
  }

  static policyAt(policies: InventoryCostingPolicy[], date: Date): InventoryCostingPolicy | null {
    let found: InventoryCostingPolicy | null = null;
    for (const p of policies) {
      if (p.effectiveFrom.getTime() <= date.getTime() && (!p.effectiveTo || p.effectiveTo.getTime() >= date.getTime())) found = p;
    }
    return found;
  }

  async getPolicyAt(tenantId: string, organizationId: string, date: Date, tx?: PrismaTransactionClient) {
    return InventoryCostingPolicyService.policyAt(await this.loadPolicies(tenantId, organizationId, tx), date);
  }

  async create(tenantId: string, organizationId: string, userId: string, input: CreateCostingPolicyInput) {
    const effectiveFrom = toDateOnly(new Date(input.effectiveFrom));
    if (Number.isNaN(effectiveFrom.getTime())) throw new InventoryCostingPolicyInvalidError('Invalid effectiveFrom date');
    if (effectiveFrom.getUTCDate() !== 1) {
      throw new InventoryCostingPolicyInvalidError('A costing policy must take effect on the first day of a period (month) — mid-period method changes are blocked (spec section 100)');
    }
    if (!CostingMethods.includes(input.costingMethod as any)) throw new InventoryCostingPolicyInvalidError(`Unsupported costing method ${input.costingMethod}; supported: ${CostingMethods.join(', ')}`);
    if (input.averageMethod && !AverageMethods.includes(input.averageMethod as any)) throw new InventoryCostingPolicyInvalidError(`Unsupported average method ${input.averageMethod}`);
    if (input.negativeStockCostPolicy && !NegativeStockCostPolicies.includes(input.negativeStockCostPolicy as any)) throw new InventoryCostingPolicyInvalidError(`Unsupported negative stock cost policy ${input.negativeStockCostPolicy}`);
    if (input.salesReturnWithoutSourceCost && !SalesReturnWithoutSourcePolicies.includes(input.salesReturnWithoutSourceCost as any)) throw new InventoryCostingPolicyInvalidError(`Unsupported sales return fallback ${input.salesReturnWithoutSourceCost}`);
    if (input.unpostDependencyPolicy && !UnpostDependencyPolicies.includes(input.unpostDependencyPolicy as any)) throw new InventoryCostingPolicyInvalidError(`Unsupported unpost dependency policy ${input.unpostDependencyPolicy}`);

    // The engine posts through the Accounting Core mapping engine — refuse
    // to activate costing for an organization whose chart has not been
    // adopted, rather than failing later mid-posting.
    for (const key of [MappingKeys.GOODS_INVENTORY, MappingKeys.COGS, MappingKeys.OTHER_OPERATING_EXPENSE, MappingKeys.OTHER_OPERATING_INCOME, MappingKeys.ADMIN_EXPENSE]) {
      try {
        await this.mappings.resolve(tenantId, organizationId, key, effectiveFrom);
      } catch {
        throw new InventoryCostingPolicyInvalidError(`Accounting mapping ${key} is not configured for this organization — adopt a chart of accounts first`);
      }
    }

    return this.prisma.runInTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`costing:${tenantId}:${organizationId}`}))`;

      const lastFinalized = await tx.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, status: 'FINALIZED' }, orderBy: { periodStart: 'desc' } });
      if (lastFinalized && effectiveFrom.getTime() <= lastFinalized.periodEnd.getTime()) {
        throw new InventoryCostingPolicyInvalidError(`Policy cannot take effect inside finalized costing period ending ${isoDate(lastFinalized.periodEnd)}`);
      }

      const existing = await tx.inventoryCostingPolicy.findMany({ where: { tenantId, organizationId, status: 'ACTIVE' }, orderBy: { effectiveFrom: 'asc' } });
      if (existing.some((p) => p.effectiveFrom.getTime() === effectiveFrom.getTime())) {
        throw new InventoryCostingPolicyInvalidError(`A policy already takes effect on ${isoDate(effectiveFrom)}`);
      }
      const previous = [...existing].reverse().find((p) => p.effectiveFrom.getTime() < effectiveFrom.getTime());
      const next = existing.find((p) => p.effectiveFrom.getTime() > effectiveFrom.getTime());

      const costByWarehouse = input.costByWarehouse ?? previous?.costByWarehouse ?? false;
      const costByBatch = input.costByBatch ?? previous?.costByBatch ?? false;
      const hasCostHistory = (await tx.inventoryCostMovement.count({ where: { tenantId, organizationId } })) > 0;
      if (hasCostHistory && previous && (previous.costByWarehouse !== costByWarehouse || previous.costByBatch !== costByBatch)) {
        throw new InventoryCostingPolicyInvalidError('Costing dimensions (cost by warehouse / batch) cannot change once cost history exists — this requires a migration procedure');
      }
      if (!hasCostHistory && existing.length > 0) {
        // no history yet: dimension flags may still be chosen freely
      }

      if (previous) {
        const dayBefore = new Date(effectiveFrom.getTime() - 24 * 3600 * 1000);
        await tx.inventoryCostingPolicy.update({ where: { id: previous.id }, data: { effectiveTo: dayBefore, updatedBy: userId, version: { increment: 1 } } });
      }

      const created = await tx.inventoryCostingPolicy.create({
        data: {
          tenantId,
          organizationId,
          effectiveFrom,
          effectiveTo: next ? new Date(next.effectiveFrom.getTime() - 24 * 3600 * 1000) : null,
          costingMethod: input.costingMethod,
          averageMethod: input.averageMethod ?? 'MOVING_AVERAGE',
          valuationCurrencyId: input.valuationCurrencyId,
          costByWarehouse,
          costByBatch,
          financialOwnershipTypes: input.financialOwnershipTypes && input.financialOwnershipTypes.length > 0 ? input.financialOwnershipTypes : ['OWN'],
          negativeStockCostPolicy: input.negativeStockCostPolicy ?? 'LAST_KNOWN_COST',
          salesReturnWithoutSourceCost: input.salesReturnWithoutSourceCost ?? 'CURRENT_AVERAGE',
          unpostDependencyPolicy: input.unpostDependencyPolicy ?? 'BLOCK',
          recalculateBackdatedDocuments: input.recalculateBackdatedDocuments ?? true,
          allowNegativeQuantityCosting: input.allowNegativeQuantityCosting ?? true,
          reconciliationTolerance: input.reconciliationTolerance ?? '0.01',
          createdBy: userId,
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
          oldValues: previous ? { policyId: previous.id, costingMethod: previous.costingMethod, averageMethod: previous.averageMethod } : undefined,
          newValues: { effectiveFrom: isoDate(effectiveFrom), costingMethod: created.costingMethod, averageMethod: created.averageMethod, costByWarehouse, costByBatch },
        },
        tx,
      );
      return created;
    });
  }

  async get(tenantId: string, organizationId: string, id: string) {
    const policy = await this.prisma.inventoryCostingPolicy.findFirst({ where: { id, tenantId, organizationId } });
    if (!policy) throw new NotFoundAppError('InventoryCostingPolicy', id);
    return policy;
  }
}
