import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * PayrollRecalculationService (spec sections 89-96, 130). Flags a
 * `PayrollRecalculationRequest` when a retroactive HR/time/tax change
 * touches an already-calculated period — never overwrites the historical
 * `PayrollCalculationResult` (that row stays, marked `SUPERSEDED`, when
 * `PayrollCalculationService.calculate` is re-run for that period; this
 * service only tracks the QUEUE of "needs another look" items). Disclosed
 * simplification: nothing in Phase 17/18 automatically calls
 * `flag` today — `EmploymentContractService`/`TimeCorrectionService`
 * would need to import this module to do that, which this pass does not
 * wire (see docs/PAYROLL.md) — flagging is a deliberate, callable action.
 */
@Injectable()
export class PayrollRecalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async flag(tenantId: string, userId: string, dto: { employmentId: string; earliestAffectedPeriod: string; reason: string; sourceDocumentType?: string; sourceDocumentId?: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const row = await this.prisma.payrollRecalculationRequest.create({ data: { tenantId, employmentId: dto.employmentId, earliestAffectedPeriod: new Date(dto.earliestAffectedPeriod), reason: dto.reason, sourceDocumentType: dto.sourceDocumentType, sourceDocumentId: dto.sourceDocumentId, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_RECALCULATION_REQUESTED', entityType: 'PAYROLL_RECALCULATION_REQUEST', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async resolve(tenantId: string, userId: string, id: string) {
    const request = await this.prisma.payrollRecalculationRequest.findFirst({ where: { id, tenantId } });
    if (!request) throw new NotFoundAppError('PayrollRecalculationRequest', id);
    if (request.status === 'RESOLVED') throw new ValidationAppError('Already resolved');
    const row = await this.prisma.payrollRecalculationRequest.update({ where: { id }, data: { status: 'RESOLVED' } });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_RECALCULATION_RESOLVED', entityType: 'PAYROLL_RECALCULATION_REQUEST', entityId: id, action: 'UPDATE', userId, newValues: {} });
    return row;
  }

  pending(tenantId: string, organizationId?: string) {
    return this.prisma.payrollRecalculationRequest.findMany({ where: { tenantId, status: 'PENDING', ...(organizationId ? { employment: { organizationId } } : {}) }, orderBy: { earliestAffectedPeriod: 'asc' } });
  }
}
