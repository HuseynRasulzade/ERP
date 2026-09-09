import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { Decimal } from '@prisma/client/runtime/library';

const VALID_TYPES = ['SALE', 'PURCHASE'];

/**
 * Phase 3 — Price List & Product Price service (section 90-92).
 * Organization-scoped effective-dated pricing.
 */
@Injectable()
export class PriceListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false, type?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.priceList.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }), ...(type ? { priceListType: type as any } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!VALID_TYPES.includes(input.priceListType)) throw new ValidationAppError('Unknown price list type');

    const currency = await this.prisma.currency.findUnique({ where: { id: input.currencyId } });
    if (!currency) throw new ValidationAppError('Currency not found');

    if (input.validTo && new Date(input.validTo) < new Date(input.validFrom)) {
      throw new ValidationAppError('validTo must not be earlier than validFrom');
    }

    const existing = await this.prisma.priceList.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Price list code already exists: ${input.code}`);

    if (input.counterpartyId) {
      const cp = await this.prisma.counterparty.findFirst({ where: { id: input.counterpartyId, organizationId } });
      if (!cp) throw new ValidationAppError('Counterparty does not belong to this organization');
    }

    const pl = await this.prisma.priceList.create({
      data: {
        tenantId, organizationId, createdBy: userId, updatedBy: userId,
        priceListType: input.priceListType, code: input.code, name: input.name,
        description: input.description, currencyId: input.currencyId,
        validFrom: new Date(input.validFrom), validTo: input.validTo ? new Date(input.validTo) : null,
        counterpartyId: input.counterpartyId, priority: input.priority ?? 0,
        includesTax: input.includesTax ?? false,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'PRICE_LIST_CREATED', entityType: 'PriceList',
      entityId: pl.id, action: 'CREATE', userId, newValues: { code: pl.code },
    });
    return pl;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const pl = await this.prisma.priceList.findFirst({
      where: { id, organizationId },
      include: { prices: { where: { active: true }, include: { product: { select: { id: true, code: true, name: true } }, unit: { select: { id: true, code: true } } } } },
    });
    if (!pl) throw new NotFoundAppError('PriceList', id);
    return pl;
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.description !== undefined) updateData.description = patch.description;
    if (patch.validFrom !== undefined) updateData.validFrom = new Date(patch.validFrom);
    if (patch.validTo !== undefined) updateData.validTo = patch.validTo ? new Date(patch.validTo) : null;
    if (patch.counterpartyId !== undefined) updateData.counterpartyId = patch.counterpartyId;
    if (patch.priority !== undefined) updateData.priority = patch.priority;
    if (patch.includesTax !== undefined) updateData.includesTax = patch.includesTax;

    const result = await this.prisma.priceList.updateMany({
      where: { id, organizationId, version: expectedVersion }, data: updateData,
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'PRICE_LIST_UPDATED', entityType: 'PriceList',
      entityId: id, action: 'UPDATE', userId, newValues: patch,
    });
    return this.prisma.priceList.findUnique({ where: { id } });
  }

  async deactivate(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const pl = await this.get(tenantId, membershipId, organizationId, id);
    if (!pl.active) throw new ValidationAppError('Price list is already inactive');

    const result = await this.prisma.priceList.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'PRICE_LIST_DEACTIVATED', entityType: 'PriceList',
      entityId: id, action: 'DEACTIVATE', userId,
    });
    return this.prisma.priceList.findUnique({ where: { id } });
  }

  async addPrice(tenantId: string, membershipId: string, organizationId: string, priceListId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, priceListId);

    const price = new Decimal(input.price.toString());
    if (price.lte(0)) throw new ValidationAppError('Price must be positive');

    const product = await this.prisma.product.findFirst({ where: { id: input.productId, organizationId } });
    if (!product) throw new ValidationAppError('Product does not belong to this organization');

    const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id: input.unitId, tenantId } });
    if (!unit) throw new ValidationAppError('Unit not found');

    const existing = await this.prisma.productPrice.findUnique({
      where: { priceListId_productId_unitId_minQuantity: { priceListId, productId: input.productId, unitId: input.unitId, minQuantity: new Decimal((input.minQuantity ?? 1).toString()) } },
    });
    if (existing) throw new ConflictAppError('Price already exists for this combination');

    const pp = await this.prisma.productPrice.create({
      data: {
        tenantId, priceListId, productId: input.productId, unitId: input.unitId,
        price, minQuantity: new Decimal((input.minQuantity ?? 1).toString()),
        maxQuantity: input.maxQuantity ? new Decimal(input.maxQuantity.toString()) : null,
        createdBy: userId, updatedBy: userId,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'PRODUCT_PRICE_ADDED', entityType: 'PriceList',
      entityId: priceListId, action: 'CREATE', userId, newValues: { productId: input.productId, price: price.toString() },
    });
    return pp;
  }

  /**
   * Resolve the best price for a product given organization, type, counterparty, quantity, and date.
   * Considers effective dating, counterparty specificity, quantity breaks, and priority.
   */
  async resolvePrice(
    tenantId: string, membershipId: string, organizationId: string,
    priceListType: string, productId: string, businessDate: Date,
    quantity = 1, counterpartyId?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!VALID_TYPES.includes(priceListType)) throw new ValidationAppError('Unknown price list type');
    if (Number.isNaN(businessDate.getTime())) throw new ValidationAppError('Invalid business date');

    const candidateLists = await this.prisma.priceList.findMany({
      where: {
        organizationId, active: true, priceListType: priceListType as any,
        validFrom: { lte: businessDate },
        OR: [{ validTo: null }, { validTo: { gte: businessDate } }],
      },
      orderBy: { priority: 'desc' },
    });

    // Prefer counterparty-specific lists first
    const sorted = [...candidateLists].sort((a, b) => {
      const aMatch = counterpartyId && a.counterpartyId === counterpartyId ? 1 : 0;
      const bMatch = counterpartyId && b.counterpartyId === counterpartyId ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.priority - a.priority;
    });

    for (const pl of sorted) {
      // Skip counterparty-specific lists that don't match
      if (pl.counterpartyId && pl.counterpartyId !== counterpartyId) continue;

      const prices = await this.prisma.productPrice.findMany({
        where: { priceListId: pl.id, productId, active: true },
        orderBy: { minQuantity: 'desc' },
      });

      const qty = new Decimal(quantity.toString());
      for (const p of prices) {
        if (qty.gte(p.minQuantity) && (!p.maxQuantity || qty.lte(p.maxQuantity))) {
          return { ...p, priceListId: pl.id, priceListCode: pl.code };
        }
      }
    }

    return null; // No matching price found
  }
}
