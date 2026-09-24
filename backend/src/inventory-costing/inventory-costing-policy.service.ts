import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';

export const COSTING_METHODS = ['FIFO', 'WEIGHTED_AVERAGE'] as const;
export const AVERAGE_METHODS = ['MOVING_AVERAGE', 'PERIODIC_WEIGHTED_AVERAGE'] as const;

/**
 * InventoryCostingPolicyService (spec section 4) — costing method is never
 * hard-coded; it is resolved per organization, effective-dated. If an
 * organization has never configured one, `resolve()` lazily provisions a
 * sensible system default (WEIGHTED_AVERAGE / MOVING_AVERAGE) rather than
 * leaving every costed movement unable to determine a method — the default
 * is a real policy row from that point on, editable like any other.
 */
@Injectable()
export class InventoryCostingPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryCostingPolicy.findMany({
      where: { tenantId, organizationId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** Resolve the policy in effect for an organization on a given date, provisioning a default if none exists yet. Callable inside a transaction. */
  async resolve(tenantId: string, organizationId: string, date: Date, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const policy = await client.inventoryCostingPolicy.findFirst({
      where: {
        tenantId,
        organizationId,
        active: true,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (policy) return policy;

    const org = await client.organization.findFirst({ where: { id: organizationId, tenantId } });
    const tenant = await client.tenant.findUnique({ where: { id: tenantId } });
    const currencyId = tenant?.baseCurrencyId;
    if (!org || !currencyId) throw new ValidationAppError('Cannot provision a default costing policy: organization or tenant base currency not found');

    return client.inventoryCostingPolicy.create({
      data: {
        tenantId,
        organizationId,
        effectiveFrom: new Date('1970-01-01'),
        costingMethod: 'WEIGHTED_AVERAGE',
        averageMethod: 'MOVING_AVERAGE',
        valuationCurrencyId: currencyId,
        costByWarehouse: true,
      },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!COSTING_METHODS.includes(input.costingMethod)) throw new ValidationAppError('Unknown costing method');
    if (input.averageMethod && !AVERAGE_METHODS.includes(input.averageMethod)) throw new ValidationAppError('Unknown average method');

    // Spec section 100: method change mid-period is blocked by default —
    // require the new policy to start strictly after the currently active one.
    const current = await this.prisma.inventoryCostingPolicy.findFirst({
      where: { tenantId, organizationId, active: true, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(input.effectiveFrom) } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (current && new Date(input.effectiveFrom) <= current.effectiveFrom) {
      throw new ValidationAppError('New policy effective date must be after the currently active policy — costing method cannot change retroactively');
    }

    return this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.inventoryCostingPolicy.update({
          where: { id: current.id },
          data: { effectiveTo: new Date(new Date(input.effectiveFrom).getTime() - 86400000), updatedBy: userId },
        });
      }
      return tx.inventoryCostingPolicy.create({
        data: {
          tenantId, organizationId, createdBy: userId, updatedBy: userId,
          effectiveFrom: new Date(input.effectiveFrom),
          costingMethod: input.costingMethod,
          averageMethod: input.averageMethod ?? (input.costingMethod === 'WEIGHTED_AVERAGE' ? 'MOVING_AVERAGE' : undefined),
          valuationCurrencyId: input.valuationCurrencyId,
          includePurchaseAdditionalCosts: input.includePurchaseAdditionalCosts ?? true,
          includeCustomsCost: input.includeCustomsCost ?? true,
          includeFreight: input.includeFreight ?? true,
          allowProvisionalCost: input.allowProvisionalCost ?? true,
          allowNegativeQuantityCosting: input.allowNegativeQuantityCosting ?? true,
          recalculateBackdatedDocuments: input.recalculateBackdatedDocuments ?? true,
          costByWarehouse: input.costByWarehouse ?? true,
          costByCharacteristic: input.costByCharacteristic ?? false,
          costByBatch: input.costByBatch ?? false,
          roundingPolicy: input.roundingPolicy ?? 'STANDARD',
        },
      });
    });
  }
}
