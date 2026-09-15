import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { BOMService } from './bom.service';
import { PRODUCTION_ORDER_TYPE } from './production-order.repository';

const SEQUENCE_PREFIX = 'PO-MFG';

@Injectable()
export class ProductionOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly bom: BOMService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: {
      documentDate: string;
      productionStartDate?: string;
      plannedEndDate?: string;
      productionType?: string;
      outputWarehouseId: string;
      bomVersionId?: string; // resolved effective-dated from outputProductId if omitted (spec section 9)
      outputProductId: string;
      routingVersionId?: string;
      costCenterId?: string;
      projectId?: string;
      responsibleUserId?: string;
      plannedOutputQuantity: number;
      outputUnitId: string;
      priority?: number;
      byProducts?: { productId: string; plannedQuantity: number; unitId: string; outputType: string; costAllocationMethod?: string; allocationWeight?: number }[];
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const documentDate = this.parseDate(dto.documentDate);
    const bomVersion = dto.bomVersionId ? await this.prisma.bOMVersion.findFirstOrThrow({ where: { id: dto.bomVersionId, tenantId } }) : await this.bom.resolveActiveVersion(tenantId, dto.outputProductId, documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PRODUCTION_ORDER_TYPE, documentDate, tx);
      const order = await tx.productionOrder.create({
        data: {
          tenantId,
          organizationId,
          documentDate,
          productionStartDate: dto.productionStartDate ? new Date(dto.productionStartDate) : undefined,
          plannedEndDate: dto.plannedEndDate ? new Date(dto.plannedEndDate) : undefined,
          productionType: dto.productionType ?? 'MAKE_TO_STOCK',
          outputWarehouseId: dto.outputWarehouseId,
          bomVersionId: bomVersion.id,
          routingVersionId: dto.routingVersionId,
          costCenterId: dto.costCenterId,
          projectId: dto.projectId,
          responsibleUserId: dto.responsibleUserId,
          plannedOutputQuantity: dto.plannedOutputQuantity.toString(),
          priority: dto.priority ?? 100,
          number: allocated.formatted,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await tx.productionOrderOutput.create({ data: { tenantId, productionOrderId: order.id, productId: dto.outputProductId, plannedQuantity: dto.plannedOutputQuantity.toString(), unitId: dto.outputUnitId, outputType: 'MAIN_PRODUCT', plannedWarehouseId: dto.outputWarehouseId } });
      for (const bp of dto.byProducts ?? []) {
        await tx.productionOrderOutput.create({ data: { tenantId, productionOrderId: order.id, productId: bp.productId, plannedQuantity: bp.plannedQuantity.toString(), unitId: bp.unitId, outputType: bp.outputType, costAllocationMethod: bp.costAllocationMethod ?? 'BY_QUANTITY', allocationWeight: bp.allocationWeight?.toString(), plannedWarehouseId: dto.outputWarehouseId } });
      }

      await this.audit.record({ tenantId, eventType: 'PRODUCTION_ORDER_CREATED', entityType: PRODUCTION_ORDER_TYPE, entityId: order.id, action: 'CREATE', userId, newValues: { plannedOutputQuantity: dto.plannedOutputQuantity, bomVersionId: bomVersion.id } }, tx);
      return tx.productionOrder.findUniqueOrThrow({ where: { id: order.id }, include: { outputs: true } });
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.productionOrder.findFirst({ where: { id, organizationId }, include: { outputs: true, requirements: true } });
    if (!row) throw new NotFoundAppError('ProductionOrder', id);
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string, status?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.productionOrder.findMany({ where: { organizationId, status: status as any }, orderBy: { createdAt: 'desc' } }));
  }

  /** Material Availability view (spec section 33). */
  async materialAvailability(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const requirements = await this.prisma.productionMaterialRequirement.findMany({ where: { tenantId, productionOrderId: id } });
    return requirements.map((r) => ({ componentProductId: r.componentProductId, required: r.requiredQuantity.toString(), reserved: r.reservedQuantity.toString(), issued: r.issuedQuantity.toString(), shortage: Math.max(Number(r.requiredQuantity.toString()) - Number(r.reservedQuantity.toString()), 0).toString() }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PRODUCTION_ORDER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PRODUCTION_ORDER_TYPE, documentType: PRODUCTION_ORDER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
