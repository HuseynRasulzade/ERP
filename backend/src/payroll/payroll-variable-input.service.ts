import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** PayrollVariableInputService (spec sections 31-33) — bonuses,
 * allowances, and any other manually-authorized one-off input. */
@Injectable()
export class PayrollVariableInputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { employmentId: string; earningCode: string; payrollPeriod: string; amount?: number; percentage?: number; quantity?: number; sourceDocumentType?: string; sourceDocumentId?: string; effectiveDate: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const row = await this.prisma.payrollVariableInput.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        earningCode: dto.earningCode,
        payrollPeriod: new Date(dto.payrollPeriod),
        amount: dto.amount?.toString(),
        percentage: dto.percentage?.toString(),
        quantity: dto.quantity?.toString(),
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        effectiveDate: new Date(dto.effectiveDate),
        approvedBy: userId,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_VARIABLE_INPUT_CREATED', entityType: 'PAYROLL_VARIABLE_INPUT', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  forPeriod(tenantId: string, employmentId: string, payrollPeriod: Date) {
    return this.prisma.payrollVariableInput.findMany({ where: { tenantId, employmentId, payrollPeriod, status: 'APPROVED' } });
  }

  list(tenantId: string, employmentId?: string) {
    return this.prisma.payrollVariableInput.findMany({ where: { tenantId, employmentId }, orderBy: { payrollPeriod: 'desc' } });
  }
}
