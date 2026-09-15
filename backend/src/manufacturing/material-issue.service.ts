import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { MATERIAL_ISSUE_TYPE } from './material-issue.repository';

const SEQUENCE_PREFIX = 'MI';

@Injectable()
export class MaterialIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { productionOrderId: string; documentDate: string; issueType?: string; lines: { requirementId?: string; productId: string; unitId: string; batchId?: string; quantity: number }[] },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.productionOrder.findFirst({ where: { id: dto.productionOrderId, organizationId } });
    if (!order) throw new NotFoundAppError('ProductionOrder', dto.productionOrderId);
    if (dto.lines.length === 0) throw new ValidationAppError('A material issue requires at least one line');
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, MATERIAL_ISSUE_TYPE, documentDate, tx);
      const issue = await tx.materialIssue.create({ data: { tenantId, organizationId, productionOrderId: dto.productionOrderId, warehouseId: order.outputWarehouseId, issueType: dto.issueType ?? 'ISSUE', number: allocated.formatted, documentDate, createdBy: userId, updatedBy: userId } });
      for (const line of dto.lines) {
        await tx.materialIssueLine.create({ data: { tenantId, issueId: issue.id, requirementId: line.requirementId, productId: line.productId, unitId: line.unitId, batchId: line.batchId, quantity: line.quantity.toString() } });
      }
      await this.audit.record({ tenantId, eventType: dto.issueType === 'RETURN' ? 'PRODUCTION_MATERIAL_RETURNED' : 'PRODUCTION_MATERIAL_ISSUED', entityType: MATERIAL_ISSUE_TYPE, entityId: issue.id, action: 'CREATE', userId, newValues: { lineCount: dto.lines.length } }, tx);
      return tx.materialIssue.findUniqueOrThrow({ where: { id: issue.id }, include: { lines: true } });
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, productionOrderId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.materialIssue.findMany({ where: { organizationId, productionOrderId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: MATERIAL_ISSUE_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: MATERIAL_ISSUE_TYPE, documentType: MATERIAL_ISSUE_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
