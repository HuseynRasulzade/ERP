import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PayrollCalculationEngine } from './payroll-calculation.engine';
import { RequestRecalculationDto } from './dto/payroll.dto';

const RECALC_TYPE = 'PAYROLL_RECALCULATION_REQUEST';

/**
 * PayrollRecalculationService (docx spec Phase 19 sections 89-96) — the
 * retro/delta engine. `recalculate()` NEVER overwrites the original
 * PayrollCalculationResult: it computes a brand-new version using
 * `PayrollCalculationEngine.computeForEmployment()` (which resolves
 * compensation/tax/contribution brackets by THAT historical period's own
 * dates — spec section 96: never apply today's law to an old period),
 * persists it as version N+1, marks the old version SUPERSEDED
 * (`supersededById` points forward), and returns the delta between the
 * two so the caller can post only the difference (spec section 92) rather
 * than a duplicate full payroll.
 */
@Injectable()
export class PayrollRecalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly engine: PayrollCalculationEngine,
  ) {}

  async request(tenantId: string, userId: string, dto: RequestRecalculationDto) {
    return this.prisma.payrollRecalculationRequest.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        earliestAffectedPeriodId: dto.earliestAffectedPeriodId,
        reason: dto.reason,
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
      },
    });
  }

  listPending(tenantId: string, employmentId?: string) {
    return this.prisma.payrollRecalculationRequest.findMany({
      where: { tenantId, status: 'PENDING', ...(employmentId ? { employmentId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async recalculate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    requestId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const request = await this.prisma.payrollRecalculationRequest.findFirst({
      where: { id: requestId, tenantId },
    });
    if (!request) throw new NotFoundAppError('PayrollRecalculationRequest', requestId);
    if (request.status !== 'PENDING')
      throw new ValidationAppError(`Cannot process a recalculation request in status ${request.status}`);

    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: request.earliestAffectedPeriodId, organizationId },
    });
    if (!period) throw new NotFoundAppError('PayrollPeriod', request.earliestAffectedPeriodId);

    const existing = await this.prisma.payrollCalculationResult.findFirst({
      where: { tenantId, employmentId: request.employmentId, payrollPeriodId: period.id, status: 'CALCULATED' },
      orderBy: { version: 'desc' },
    });
    if (!existing)
      throw new ValidationAppError(
        'No prior calculated result for this employment/period — run a regular calculation first',
      );

    const run = await this.prisma.payrollCalculationRun.create({
      data: {
        tenantId,
        organizationId,
        payrollPeriodId: period.id,
        runType: 'RETROACTIVE',
        version: existing.version + 1,
        initiatedBy: userId,
        status: 'RUNNING',
      },
    });

    const computed = await this.engine.computeForEmployment(tenantId, request.employmentId, period);
    const persisted = await this.engine.persistResult(
      tenantId,
      request.employmentId,
      period,
      run.id,
      existing.version + 1,
      computed,
    );

    await this.prisma.payrollCalculationResult.update({
      where: { id: existing.id },
      data: { status: 'SUPERSEDED', supersededById: persisted.result.id },
    });
    await this.prisma.payrollCalculationRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        employeesProcessed: 1,
        totalGross: persisted.gross,
        totalNet: persisted.net,
        totalTaxes: persisted.taxes,
        totalEmployerCost: persisted.employerTotalCost,
      },
    });
    await this.prisma.payrollRecalculationRequest.update({
      where: { id: requestId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    const delta = {
      gross: persisted.gross.minus(existing.gross.toString()).toFixed(2),
      employeeDeductions: persisted.taxes.minus(existing.employeeDeductions.toString()).toFixed(2),
      net: persisted.net.minus(existing.net.toString()).toFixed(2),
      employerContributions: computed.g2n.employerContributions
        .minus(existing.employerContributions.toString())
        .toFixed(2),
    };

    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_RECALCULATED',
      entityType: RECALC_TYPE,
      entityId: requestId,
      action: 'UPDATE',
      userId,
      oldValues: { resultId: existing.id, gross: existing.gross.toString(), net: existing.net.toString() },
      newValues: { resultId: persisted.result.id, gross: persisted.gross.toFixed(2), net: persisted.net.toFixed(2) },
      reason: request.reason,
    });

    return {
      originalResultId: existing.id,
      correctedResultId: persisted.result.id,
      originalVersion: existing.version,
      correctedVersion: existing.version + 1,
      delta,
    };
  }
}
