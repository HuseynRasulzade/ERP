import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ProductCatalogCodeService } from './product-catalog-code.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface ProductParentCategoryInput {
  name: string;
}

/**
 * Product Parent Category ("Üst Kateqoriya") service.
 * Independent master catalog: organization-scoped, flat (no hierarchy of
 * its own), with a system-generated immutable code. ProductCategory rows
 * reference it via parentGroupId (see ProductCategoryService).
 */
@Injectable()
export class ProductParentCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly codeService: ProductCatalogCodeService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.productParentCategory.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    input: ProductParentCategoryInput,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const code = await this.codeService.allocate(organizationId, 'PARENT_CATEGORY', 'UK');

    const parentCategory = await this.prisma.productParentCategory.create({
      data: { tenantId, organizationId, code, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_PARENT_CATEGORY_CREATED',
      entityType: 'ProductParentCategory',
      entityId: parentCategory.id,
      action: 'CREATE',
      userId,
      newValues: { code: parentCategory.code, name: parentCategory.name },
    });

    return parentCategory;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const parentCategory = await this.prisma.productParentCategory.findFirst({
      where: { id, organizationId },
    });
    if (!parentCategory) throw new NotFoundAppError('ProductParentCategory', id);
    return parentCategory;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<ProductParentCategoryInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const result = await this.prisma.productParentCategory.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_PARENT_CATEGORY_UPDATED',
      entityType: 'ProductParentCategory',
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.productParentCategory.findUnique({ where: { id } });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const parentCategory = await this.get(tenantId, membershipId, organizationId, id);
    if (!parentCategory.active) throw new ValidationAppError('Parent category is already inactive');

    const categoriesUsingIt = await this.prisma.productCategory.count({
      where: { organizationId, parentGroupId: id, active: true },
    });
    if (categoriesUsingIt > 0) {
      throw new ValidationAppError(`Cannot delete parent category: ${categoriesUsingIt} active categories are using it`);
    }

    const result = await this.prisma.productParentCategory.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'PRODUCT_PARENT_CATEGORY_DEACTIVATED',
      entityType: 'ProductParentCategory',
      entityId: id,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.productParentCategory.findUnique({ where: { id } });
  }
}
