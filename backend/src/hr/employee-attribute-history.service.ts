import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError } from '../common/errors/app-error';

/** EmployeeAttributeHistoryService (spec section 59) — localization/
 * tax/social attribute extension point, effective-dated. Deliberately
 * NOT used for core typed fields (spec's own "Overuse etmə"). */
@Injectable()
export class EmployeeAttributeHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async set(tenantId: string, userId: string, dto: { employeeId?: string; employmentId?: string; attributeType: string; value: string; effectiveFrom: string; sourceDocumentType?: string; sourceDocumentId?: string }) {
    if (!dto.employeeId && !dto.employmentId) throw new ValidationAppError('Either employeeId or employmentId is required');
    const effectiveFrom = new Date(dto.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const openWhere = dto.employeeId ? { tenantId, employeeId: dto.employeeId, attributeType: dto.attributeType, effectiveTo: null } : { tenantId, employmentId: dto.employmentId, attributeType: dto.attributeType, effectiveTo: null };
      await tx.employeeAttributeHistory.updateMany({ where: openWhere, data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) } });
      const row = await tx.employeeAttributeHistory.create({ data: { tenantId, employeeId: dto.employeeId, employmentId: dto.employmentId, attributeType: dto.attributeType, value: dto.value, effectiveFrom, sourceDocumentType: dto.sourceDocumentType, sourceDocumentId: dto.sourceDocumentId, createdBy: userId } });
      await this.audit.record({ tenantId, eventType: 'HR_ATTRIBUTE_CHANGED', entityType: 'EMPLOYEE_ATTRIBUTE_HISTORY', entityId: row.id, action: 'CREATE', userId, newValues: { attributeType: dto.attributeType, value: dto.value } }, tx);
      return row;
    });
  }

  history(tenantId: string, employeeId: string, attributeType?: string) {
    return this.prisma.employeeAttributeHistory.findMany({ where: { tenantId, employeeId, attributeType }, orderBy: { effectiveFrom: 'desc' } });
  }

  async getAsOf(tenantId: string, employeeId: string, attributeType: string, asOfDate: Date) {
    return this.prisma.employeeAttributeHistory.findFirst({ where: { tenantId, employeeId, attributeType, effectiveFrom: { lte: asOfDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] }, orderBy: { effectiveFrom: 'desc' } });
  }
}
