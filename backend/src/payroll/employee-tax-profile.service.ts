import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** EmployeeTaxProfileService (spec sections 48-49, 88) — effective-dated,
 * including `mainWorkplace` itself (never a plain current-state boolean). */
@Injectable()
export class EmployeeTaxProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assign(tenantId: string, userId: string, dto: { employmentId: string; effectiveFrom: string; taxResidency?: string; mainWorkplace?: boolean; sectorCategory?: string; taxRegime?: string; exemptionAmount?: number; exemptionCodes?: string; supportingDocumentAssetId?: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const effectiveFrom = new Date(dto.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const current = await tx.employeeTaxProfile.findFirst({ where: { tenantId, employmentId: dto.employmentId, status: 'ACTIVE', effectiveTo: null } });
      if (current) await tx.employeeTaxProfile.update({ where: { id: current.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) } });
      const row = await tx.employeeTaxProfile.create({
        data: {
          tenantId,
          employmentId: dto.employmentId,
          effectiveFrom,
          taxResidency: dto.taxResidency ?? 'RESIDENT',
          mainWorkplace: dto.mainWorkplace ?? true,
          sectorCategory: dto.sectorCategory ?? 'NON_OIL_PRIVATE',
          taxRegime: dto.taxRegime ?? 'DEFAULT',
          exemptionAmount: (dto.exemptionAmount ?? 0).toString(),
          exemptionCodes: dto.exemptionCodes,
          supportingDocumentAssetId: dto.supportingDocumentAssetId,
          createdBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'PAYROLL_TAX_PROFILE_ASSIGNED', entityType: 'EMPLOYEE_TAX_PROFILE', entityId: row.id, action: 'CREATE', userId, newValues: dto }, tx);
      return row;
    });
  }

  getAsOf(tenantId: string, employmentId: string, date: Date) {
    return this.prisma.employeeTaxProfile.findFirst({ where: { tenantId, employmentId, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' } });
  }

  history(tenantId: string, employmentId: string) {
    return this.prisma.employeeTaxProfile.findMany({ where: { tenantId, employmentId }, orderBy: { effectiveFrom: 'asc' } });
  }
}
