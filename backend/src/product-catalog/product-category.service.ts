import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface ProductCategoryInput {
  code: string;
  name: string;
  parentCategoryId?: string;
  description?: string;
}

/**
 * Phase 2 — Product Category service (section 80).
 * Hierarchical product classification, organization-scoped.
 * Cycles are validated server-side (same pattern as Department).
 */
@Injectable()
export class ProductCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.productCategory.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
      include: {
        parentCategory: { select: { id: true, code: true, name: true } },
      },
    });
  }

  /**
   * Check that setting parentCategoryId would not create a cycle.
   * A category cannot be its own parent, and cannot be re-parented into
   * one of its own descendants.
   */
  private async assertNoCycle(organizationId: string, categoryId: string, parentCategoryId?: string) {
    if (!parentCategoryId) return;
    if (categoryId === parentCategoryId) {
      throw new ValidationAppError('A category cannot be its own parent');
    }

    // Walk up the parent chain from the proposed parent and ensure we never
    // reach categoryId — if we do, it's a cycle.
    let currentId: string | null = parentCategoryId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === categoryId) {
        throw new ValidationAppError('Cannot create a circular category hierarchy');
      }
      if (visited.has(currentId)) {
        throw new ValidationAppError('Category hierarchy contains a cycle');
      }
      visited.add(currentId);

      const parent = await this.prisma.productCategory.findFirst({
        where: { id: currentId, organizationId },
        select: { parentCategoryId: true },
      });
      if (!parent) break;
      currentId = parent.parentCategoryId;
    }
  }

  private async assertParentBelongsToOrganization(organizationId: string, parentCategoryId?: string) {
    if (!parentCategoryId) return;
    const parent = await this.prisma.productCategory.findFirst({
      where: { id: parentCategoryId, organizationId },
    });
    if (!parent) {
      throw new ValidationAppError('Parent category does not belong to this organization');
    }
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: ProductCategoryInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertParentBelongsToOrganization(organizationId, input.parentCategoryId);

    const existing = await this.prisma.productCategory.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Product category code already exists: ${input.code}`);

    const category = await this.prisma.productCategory.create({
      data: { tenantId, organizationId, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_CATEGORY_CREATED',
      entityType: 'ProductCategory',
      entityId: category.id,
      action: 'CREATE',
      userId,
      newValues: { code: category.code, name: category.name },
    });

    return category;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, categoryId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, organizationId },
      include: {
        parentCategory: { select: { id: true, code: true, name: true } },
      },
    });
    if (!category) throw new NotFoundAppError('ProductCategory', categoryId);
    return category;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    categoryId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<ProductCategoryInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.parentCategoryId !== undefined) {
      await this.assertParentBelongsToOrganization(organizationId, patch.parentCategoryId);
      await this.assertNoCycle(organizationId, categoryId, patch.parentCategoryId);
    }

    const result = await this.prisma.productCategory.updateMany({
      where: { id: categoryId, organizationId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_CATEGORY_UPDATED',
      entityType: 'ProductCategory',
      entityId: categoryId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.productCategory.findUnique({ where: { id: categoryId } });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    categoryId: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const category = await this.get(tenantId, membershipId, organizationId, categoryId);
    if (!category.active) throw new ValidationAppError('Product category is already inactive');

    // Check if any active products are using this category
    const productsUsingCategory = await this.prisma.product.count({
      where: { organizationId, categoryId, active: true },
    });
    if (productsUsingCategory > 0) {
      throw new ValidationAppError(`Cannot deactivate category: ${productsUsingCategory} active products are using it`);
    }

    // Check if any active child categories exist
    const activeChildren = await this.prisma.productCategory.count({
      where: { organizationId, parentCategoryId: categoryId, active: true },
    });
    if (activeChildren > 0) {
      throw new ValidationAppError(`Cannot deactivate category: ${activeChildren} active child categories exist`);
    }

    const result = await this.prisma.productCategory.updateMany({
      where: { id: categoryId, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_CATEGORY_DEACTIVATED',
      entityType: 'ProductCategory',
      entityId: categoryId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.productCategory.findUnique({ where: { id: categoryId } });
  }

  /**
   * Resolve descendants of a category (all levels deep) for tree rendering.
   */
  async getDescendants(tenantId: string, membershipId: string, organizationId: string, categoryId: string): Promise<string[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const descendants: string[] = [];
    const toProcess = [categoryId];

    while (toProcess.length > 0) {
      const current = toProcess.shift()!;
      const children = await this.prisma.productCategory.findMany({
        where: { organizationId, parentCategoryId: current },
        select: { id: true },
      });
      for (const child of children) {
        descendants.push(child.id);
        toProcess.push(child.id);
      }
    }

    return descendants;
  }
}
