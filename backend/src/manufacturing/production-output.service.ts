import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PRODUCTION_OUTPUT_RECEIPT_TYPE } from './production-output.repository';

const SEQUENCE_PREFIX = 'PGR';

@Injectable()
export class ProductionOutputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { productionOrderId: string; outputId: string; outputKind?: string; warehouseId?: string; batchId?: string; goodQuantity: number; qualityStatus?: string; documentDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const output = await this.prisma.productionOrderOutput.findFirst({ where: { id: dto.outputId, tenantId, productionOrderId: dto.productionOrderId } });
    if (!output) throw new NotFoundAppError('ProductionOrderOutput', dto.outputId);
    const order = await this.prisma.productionOrder.findFirstOrThrow({ where: { id: dto.productionOrderId, tenantId } });
    if (dto.goodQuantity <= 0) throw new ValidationAppError('Good quantity must be positive');
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PRODUCTION_OUTPUT_RECEIPT_TYPE, documentDate, tx);
      const row = await tx.productionOutputReceipt.create({
        data: {
          tenantId,
          organizationId,
          productionOrderId: dto.productionOrderId,
          outputId: dto.outputId,
          outputKind: dto.outputKind ?? 'FINISHED',
          warehouseId: dto.warehouseId ?? output.plannedWarehouseId ?? order.outputWarehouseId,
          batchId: dto.batchId,
          goodQuantity: dto.goodQuantity.toString(),
          qualityStatus: dto.qualityStatus ?? 'ACCEPTED',
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'PRODUCTION_OUTPUT_RECEIVED', entityType: PRODUCTION_OUTPUT_RECEIPT_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { goodQuantity: dto.goodQuantity } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, productionOrderId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.productionOutputReceipt.findMany({ where: { organizationId, productionOrderId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PRODUCTION_OUTPUT_RECEIPT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PRODUCTION_OUTPUT_RECEIPT_TYPE, documentType: PRODUCTION_OUTPUT_RECEIPT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
