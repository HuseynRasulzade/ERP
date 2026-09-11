import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { Decimal } from '@prisma/client/runtime/library';

const VALID_PRODUCT_TYPES = ['GOODS', 'SERVICE', 'WORK', 'SET'];

export interface ProductInput {
  code: string;
  name: string;
  fullName?: string;
  categoryId?: string;
  productType: string;
  baseUnitId: string;
  description?: string;
  sku?: string;
  barcode?: string;
  manufacturer?: string;
  brand?: string;
  model?: string;
  weight?: number | Decimal;
  weightUnitId?: string;
  volume?: number | Decimal;
  volumeUnitId?: string;
  trackInventory?: boolean;
  allowNegativeStock?: boolean;
  batchTrackingMode?: string;
  serialTrackingMode?: string;
}

/**
 * Phase 2 — Product service (section 81-84).
 * Organization-scoped product master data. Master data only: no stock
 * balances, no pricing, no supplier/customer references yet (Phase 3+).
 * A product's identity must stay stable once transactional documents
 * reference it: deactivate rather than repurpose.
 */
@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.product.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, code: true, name: true } },
        baseUnit: { select: { id: true, code: true, name: true, symbol: true } },
      },
    });
  }

  private assertValidType(type: string) {
    if (!VALID_PRODUCT_TYPES.includes(type)) {
      throw new ValidationAppError(`Unknown product type: ${type}. Valid types: ${VALID_PRODUCT_TYPES.join(', ')}`);
    }
  }

  private async assertCategoryBelongsToOrganization(organizationId: string, categoryId?: string) {
    if (!categoryId) return;
    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, organizationId },
    });
    if (!category) {
      throw new ValidationAppError('Category does not belong to this organization');
    }
  }

  private async assertUnitExists(tenantId: string, unitId: string) {
    const unit = await this.prisma.unitOfMeasure.findFirst({
      where: { id: unitId, tenantId },
    });
    if (!unit) {
      throw new ValidationAppError('Unit of measure not found');
    }
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: ProductInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    this.assertValidType(input.productType);
    await this.assertCategoryBelongsToOrganization(organizationId, input.categoryId);
    await this.assertUnitExists(tenantId, input.baseUnitId);
    if (input.weightUnitId) await this.assertUnitExists(tenantId, input.weightUnitId);
    if (input.volumeUnitId) await this.assertUnitExists(tenantId, input.volumeUnitId);

    const existing = await this.prisma.product.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Product code already exists: ${input.code}`);

    // Check SKU uniqueness within tenant if provided
    if (input.sku) {
      const existingSku = await this.prisma.product.findFirst({
        where: { tenantId, sku: input.sku, active: true },
      });
      if (existingSku) throw new ConflictAppError(`SKU already exists: ${input.sku}`);
    }

    // Check barcode uniqueness within tenant if provided
    if (input.barcode) {
      const existingBarcode = await this.prisma.product.findFirst({
        where: { tenantId, barcode: input.barcode, active: true },
      });
      if (existingBarcode) throw new ConflictAppError(`Barcode already exists: ${input.barcode}`);
    }

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        organizationId,
        createdBy: userId,
        updatedBy: userId,
        ...input,
        // `productType` arrives as a validated string; cast to the native
        // Prisma enum (same pattern as CounterpartyService.counterpartyType).
        productType: input.productType as any,
        weight: input.weight ? new Decimal(input.weight.toString()) : null,
        volume: input.volume ? new Decimal(input.volume.toString()) : null,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_CREATED',
      entityType: 'Product',
      entityId: product.id,
      action: 'CREATE',
      userId,
      newValues: { code: product.code, name: product.name, productType: product.productType },
    });

    return product;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, productId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      include: {
        category: { select: { id: true, code: true, name: true } },
        baseUnit: { select: { id: true, code: true, name: true, symbol: true } },
      },
    });
    if (!product) throw new NotFoundAppError('Product', productId);
    return product;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    productId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<ProductInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.productType) this.assertValidType(patch.productType);
    if (patch.categoryId !== undefined) await this.assertCategoryBelongsToOrganization(organizationId, patch.categoryId);
    if (patch.baseUnitId) await this.assertUnitExists(tenantId, patch.baseUnitId);
    if (patch.weightUnitId) await this.assertUnitExists(tenantId, patch.weightUnitId);
    if (patch.volumeUnitId) await this.assertUnitExists(tenantId, patch.volumeUnitId);

    // Check SKU uniqueness if changing
    if (patch.sku !== undefined) {
      const existingSku = await this.prisma.product.findFirst({
        where: { tenantId, sku: patch.sku, active: true, NOT: { id: productId } },
      });
      if (existingSku) throw new ConflictAppError(`SKU already exists: ${patch.sku}`);
    }

    // Check barcode uniqueness if changing
    if (patch.barcode !== undefined) {
      const existingBarcode = await this.prisma.product.findFirst({
        where: { tenantId, barcode: patch.barcode, active: true, NOT: { id: productId } },
      });
      if (existingBarcode) throw new ConflictAppError(`Barcode already exists: ${patch.barcode}`);
    }

    // Cast validated productType string to the native Prisma enum (create
    // path does the same) — otherwise `updateMany` data rejects the string.
    const updateData: any = {
      ...patch,
      ...(patch.productType ? { productType: patch.productType as any } : {}),
      updatedBy: userId,
      version: { increment: 1 },
    };
    if (patch.weight !== undefined) {
      updateData.weight = patch.weight ? new Decimal(patch.weight.toString()) : null;
    }
    if (patch.volume !== undefined) {
      updateData.volume = patch.volume ? new Decimal(patch.volume.toString()) : null;
    }

    const result = await this.prisma.product.updateMany({
      where: { id: productId, organizationId, version: expectedVersion },
      data: updateData,
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_UPDATED',
      entityType: 'Product',
      entityId: productId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.product.findUnique({ where: { id: productId } });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    productId: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const product = await this.get(tenantId, membershipId, organizationId, productId);
    if (!product.active) throw new ValidationAppError('Product is already inactive');

    // TODO Phase 3+: check if product is referenced by any active documents
    // (sales orders, purchase orders, etc.) before allowing deactivation

    const result = await this.prisma.product.updateMany({
      where: { id: productId, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_DEACTIVATED',
      entityType: 'Product',
      entityId: productId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.product.findUnique({ where: { id: productId } });
  }

  /**
   * Search products by code, name, SKU, or barcode within an organization.
   */
  async search(tenantId: string, membershipId: string, organizationId: string, query: string, limit = 20) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.product.findMany({
      where: {
        organizationId,
        active: true,
        OR: [
          { code: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { equals: query } },
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, code: true, name: true } },
        baseUnit: { select: { id: true, code: true, name: true, symbol: true } },
      },
    });
  }
}
