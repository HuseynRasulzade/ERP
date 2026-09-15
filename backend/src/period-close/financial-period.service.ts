import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * FinancialPeriodService (docx spec Phase 22, sections 3-6). A richer,
 * close-orchestration-specific period entity layered ON TOP OF Phase 4's
 * `AccountingPeriod` (the actual posting guard) — never a replacement for
 * it. `PeriodLockService` is the bridge: only IT ever flips the
 * underlying `AccountingPeriod.status` (spec section 114). See
 * docs/MONTH_CLOSE.md section A.
 */
@Injectable()
export class FinancialPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, userId: string, dto: { organizationId: string; fiscalYear: number; periodNumber: number; periodType?: string }) {
    await this.access.assertAccess(tenantId, membershipId, dto.organizationId);
    const periodType = dto.periodType ?? 'MONTH';
    const existing = await this.prisma.financialPeriod.findFirst({ where: { tenantId, organizationId: dto.organizationId, fiscalYear: dto.fiscalYear, periodNumber: dto.periodNumber, periodType } });
    if (existing) throw new ConflictAppError('A financial period already exists for this year/period/type');

    const { periodStart, periodEnd } = this.computeBounds(dto.fiscalYear, dto.periodNumber, periodType);
    const period = await this.prisma.financialPeriod.create({
      data: { tenantId, organizationId: dto.organizationId, fiscalYear: dto.fiscalYear, periodNumber: dto.periodNumber, periodType, periodStart, periodEnd, status: 'OPEN' },
    });
    await this.audit.record({ tenantId, eventType: 'FINANCIAL_PERIOD_CREATED', entityType: 'FinancialPeriod', entityId: period.id, action: 'CREATE', userId, newValues: { fiscalYear: dto.fiscalYear, periodNumber: dto.periodNumber } });
    return period;
  }

  private computeBounds(fiscalYear: number, periodNumber: number, periodType: string): { periodStart: Date; periodEnd: Date } {
    if (periodType === 'YEAR') return { periodStart: new Date(Date.UTC(fiscalYear, 0, 1)), periodEnd: new Date(Date.UTC(fiscalYear, 11, 31)) };
    if (periodType === 'QUARTER') {
      const startMonth = (periodNumber - 1) * 3;
      return { periodStart: new Date(Date.UTC(fiscalYear, startMonth, 1)), periodEnd: new Date(Date.UTC(fiscalYear, startMonth + 3, 0)) };
    }
    // MONTH and ADJUSTMENT_PERIOD (a 13th period is caller-defined bounds
    // in principle, but this build treats it as a plain month slot too —
    // disclosed in docs/MONTH_CLOSE.md).
    return { periodStart: new Date(Date.UTC(fiscalYear, periodNumber - 1, 1)), periodEnd: new Date(Date.UTC(fiscalYear, periodNumber, 0)) };
  }

  async get(tenantId: string, id: string) {
    const period = await this.prisma.financialPeriod.findFirst({ where: { id, tenantId } });
    if (!period) throw new NotFoundAppError('FinancialPeriod', id);
    return period;
  }

  list(tenantId: string, organizationId: string) {
    return this.prisma.financialPeriod.findMany({ where: { tenantId, organizationId }, orderBy: [{ fiscalYear: 'desc' }, { periodNumber: 'desc' }] });
  }

  /** Bump the mutation token (spec section 25) whenever a posting lands
   * inside an open financial period so a running close run can detect
   * staleness at finalize time. Called by `PeriodCloseStepExecutor`'s
   * readiness checks, not wired into every posting path in this build
   * (disclosed simplification — see docs/MONTH_CLOSE.md section D). */
  async bumpDataVersion(tenantId: string, id: string) {
    return this.prisma.financialPeriod.update({ where: { id }, data: { dataVersion: { increment: 1 } } });
  }

  async setStatus(tenantId: string, id: string, status: string, extra: Record<string, unknown> = {}) {
    const period = await this.get(tenantId, id);
    return this.prisma.financialPeriod.update({ where: { id: period.id }, data: { status, ...extra } });
  }

  async assertStatus(tenantId: string, id: string, allowed: string[]) {
    const period = await this.get(tenantId, id);
    if (!allowed.includes(period.status)) {
      throw new ValidationAppError(`FinancialPeriod ${id} is ${period.status}; expected one of ${allowed.join(', ')}`);
    }
    return period;
  }
}
