import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import { StructuralValidationService } from './structural-validation.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const VALID_WAREHOUSE_TYPES = ['STANDARD', 'RETAIL', 'TRANSIT', 'PRODUCTION', 'RESPONSIBLE_STORAGE'];

export interface WarehouseInput {
  code: string;
  name: string;
  branchId?: string;
  warehouseType?: string;
  address?: string;
  responsiblePersonId?: string;
  allowNegativeStock?: boolean;
}

/**
 * Structural warehouse MASTER DATA ONLY (section 11-13) — stock
 * balances/movements belong to Phase 10. A warehouse's identity must stay
 * stable once transactional documents can reference it: deactivate and
 * create a new record rather than repurposing one into a different
 * physical warehouse (section 12).
 */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly validation: StructuralValidationService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.warehouse.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  private assertValidType(type?: string) {
    if (type && !VALID_WAREHOUSE_TYPES.includes(type)) {
      throw new ValidationAppError(`Unknown warehouse type: ${type}`);
    }
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: WarehouseInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    this.assertValidType(input.warehouseType);
    await this.validation.assertBranchBelongsToOrganization(organizationId, input.branchId);
    await this.validation.assertResponsiblePersonInTenant(tenantId, input.responsiblePersonId);

    const existing = await this.prisma.warehouse.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Warehouse code already exists: ${input.code}`);

    const warehouse = await this.prisma.warehouse.create({
      data: { tenantId, organizationId, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'WAREHOUSE_CREATED',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      action: 'CREATE',
      userId,
      newValues: { code: warehouse.code, name: warehouse.name },
    });

    return warehouse;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, warehouseId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId } });
    if (!warehouse) throw new NotFoundAppError('Warehouse', warehouseId);
    return warehouse;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    warehouseId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<WarehouseInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    this.assertValidType(patch.warehouseType);
    if (patch.branchId !== undefined) await this.validation.assertBranchBelongsToOrganization(organizationId, patch.branchId);
    if (patch.responsiblePersonId !== undefined) {
      await this.validation.assertResponsiblePersonInTenant(tenantId, patch.responsiblePersonId);
    }

    const result = await this.prisma.warehouse.updateMany({
      where: { id: warehouseId, organizationId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'WAREHOUSE_UPDATED',
      entityType: 'Warehouse',
      entityId: warehouseId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    warehouseId: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const warehouse = await this.get(tenantId, membershipId, organizationId, warehouseId);
    if (!warehouse.active) throw new ValidationAppError('Warehouse is already inactive');

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.warehouse.updateMany({
        where: { id: warehouseId, organizationId, version: expectedVersion },
        data: { active: false, updatedBy: userId, version: { increment: 1 } },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      // Section 43: an org must never keep a dangling default pointing at
      // a warehouse that just became inactive.
      await tx.organization.updateMany({
        where: { id: organizationId, defaultWarehouseId: warehouseId },
        data: { defaultWarehouseId: null },
      });
    });

    await this.audit.record({
      tenantId,
      eventType: 'WAREHOUSE_DEACTIVATED',
      entityType: 'Warehouse',
      entityId: warehouseId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
  }
}
