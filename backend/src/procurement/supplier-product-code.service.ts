import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { UpsertSupplierProductCodeDto } from './dto/procurement.dto';

const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];

/**
 * SupplierProductCode (spec sections 45-50, 55-57, 108). "Different
 * suppliers may use the same external code, no cross-supplier ambiguity" —
 * enforced by the schema's `(organizationId, counterpartyId, productId)`
 * uniqueness, so there is exactly one active mapping per supplier+product.
 */
@Injectable()
export class SupplierProductCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string, productId?: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.supplierProductCode.findMany({
          where: { organizationId, ...(counterpartyId ? { counterpartyId } : {}), ...(productId ? { productId } : {}) },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async upsert(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: UpsertSupplierProductCodeDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const supplier = await this.prisma.counterparty.findFirst({ where: { id: dto.counterpartyId, organizationId, tenantId } });
    if (!supplier) throw new ValidationAppError('Counterparty does not belong to this organization');
    if (!SUPPLIER_TYPES.includes(supplier.counterpartyType)) throw new ValidationAppError('Counterparty does not have the SUPPLIER role');

    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, organizationId } });
    if (!product) throw new ValidationAppError('Product does not belong to this organization');

    if (dto.moq !== undefined && new Decimal(dto.moq).lt(0)) throw new ValidationAppError('MOQ must not be negative');
    if (dto.orderMultiple !== undefined && new Decimal(dto.orderMultiple).lte(0)) throw new ValidationAppError('Order multiple must be positive');

    const existing = await this.prisma.supplierProductCode.findUnique({
      where: { organizationId_counterpartyId_productId: { organizationId, counterpartyId: dto.counterpartyId, productId: dto.productId } },
    });

    const dupeCode = await this.prisma.supplierProductCode.findFirst({
      where: { organizationId, counterpartyId: dto.counterpartyId, supplierCode: dto.supplierCode, productId: { not: dto.productId } },
    });
    if (dupeCode) throw new ConflictAppError(`Supplier code ${dto.supplierCode} is already mapped to a different product for this supplier`);

    const data = {
      tenantId,
      organizationId,
      counterpartyId: dto.counterpartyId,
      productId: dto.productId,
      supplierCode: dto.supplierCode,
      supplierUnitId: dto.supplierUnitId,
      moq: dto.moq !== undefined ? dto.moq.toString() : undefined,
      orderMultiple: dto.orderMultiple !== undefined ? dto.orderMultiple.toString() : undefined,
      leadTimeDays: dto.leadTimeDays,
      updatedBy: userId,
    };

    const row = existing
      ? await this.prisma.supplierProductCode.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
      : await this.prisma.supplierProductCode.create({ data: { ...data, createdBy: userId } });

    await this.audit.record({
      tenantId,
      eventType: existing ? 'SUPPLIER_PRODUCT_CODE_UPDATED' : 'SUPPLIER_PRODUCT_CODE_CREATED',
      entityType: 'SupplierProductCode',
      entityId: row.id,
      action: existing ? 'UPDATE' : 'CREATE',
      userId,
      newValues: { supplierCode: dto.supplierCode, productId: dto.productId, counterpartyId: dto.counterpartyId },
    });
    return row;
  }

  async deactivate(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.supplierProductCode.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('SupplierProductCode', id);

    const result = await this.prisma.supplierProductCode.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'SUPPLIER_PRODUCT_CODE_DEACTIVATED', entityType: 'SupplierProductCode', entityId: id, action: 'DEACTIVATE', userId });
    return this.prisma.supplierProductCode.findUnique({ where: { id } });
  }
}
