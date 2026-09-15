import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HRHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  employmentId?: string;
  message: string;
}

/** HRHealthService (spec section 98). Computed live — same
 * "rebuildable projection" pattern as every other health service in this
 * codebase. */
@Injectable()
export class HRHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<HRHealthIssue[]> {
    const issues: HRHealthIssue[] = [];

    const activeEmployments = await this.prisma.employment.findMany({ where: { tenantId, organizationId, employmentStatus: 'ACTIVE' } });
    for (const e of activeEmployments) {
      const [contract, assignment, schedule] = await Promise.all([
        this.prisma.employmentContract.findFirst({ where: { tenantId, employmentId: e.id, status: 'ACTIVE' } }),
        this.prisma.employeeAssignment.findFirst({ where: { tenantId, employmentId: e.id, effectiveTo: null } }),
        this.prisma.workScheduleAssignment.findFirst({ where: { tenantId, employmentId: e.id, effectiveTo: null } }),
      ]);
      if (!contract) issues.push({ code: 'ACTIVE_EMPLOYMENT_WITHOUT_CONTRACT', severity: 'ERROR', employmentId: e.id, message: `Employment ${e.id} is ACTIVE but has no active contract.` });
      if (!assignment) issues.push({ code: 'ACTIVE_EMPLOYMENT_WITHOUT_ASSIGNMENT', severity: 'BLOCKING', employmentId: e.id, message: `Employment ${e.id} is ACTIVE but has no open assignment history row.` });
      if (!schedule && !e.workScheduleId) issues.push({ code: 'ACTIVE_EMPLOYMENT_WITHOUT_SCHEDULE', severity: 'WARNING', employmentId: e.id, message: `Employment ${e.id} is ACTIVE but has no work schedule assigned.` });
      if (!e.managerEmploymentId) issues.push({ code: 'MISSING_MANAGER', severity: 'INFO', employmentId: e.id, message: `Employment ${e.id} has no manager assigned.` });

      if (contract && contract.effectiveTo && contract.effectiveTo < new Date()) issues.push({ code: 'EXPIRED_CONTRACT_STILL_ACTIVE', severity: 'ERROR', employmentId: e.id, message: `Employment ${e.id}'s contract expired on ${contract.effectiveTo.toISOString().slice(0, 10)} but the employment is still ACTIVE.` });

      if (e.staffingPositionId) {
        const position = await this.prisma.staffingPosition.findUnique({ where: { id: e.staffingPositionId } });
        if (position && position.status !== 'ACTIVE') issues.push({ code: 'INACTIVE_STAFFING_POSITION_OCCUPIED', severity: 'WARNING', employmentId: e.id, message: `Employment ${e.id} occupies a closed staffing position.` });
      }
    }

    const primaryEmployments = await this.prisma.employment.findMany({ where: { tenantId, organizationId, primaryEmployment: true, employmentStatus: { in: ['ACTIVE', 'PLANNED'] } } });
    const byEmployee = new Map<string, number>();
    for (const e of primaryEmployments) byEmployee.set(e.employeeId, (byEmployee.get(e.employeeId) ?? 0) + 1);
    for (const [employeeId, count] of byEmployee) if (count > 1) issues.push({ code: 'OVERLAPPING_PRIMARY_EMPLOYMENTS', severity: 'ERROR', message: `Employee ${employeeId} has ${count} overlapping primary employments.` });

    const staffingPositions = await this.prisma.staffingPosition.findMany({ where: { tenantId, organizationId, status: 'ACTIVE' } });
    for (const p of staffingPositions) {
      const occupied = await this.prisma.employeeAssignment.count({ where: { tenantId, staffingPositionId: p.id, effectiveTo: null } });
      if (occupied > p.headcountLimit) issues.push({ code: 'STAFFING_CAPACITY_EXCEEDED', severity: 'WARNING', message: `Staffing position ${p.id} has ${occupied} occupants against a headcount limit of ${p.headcountLimit}.` });
    }

    const terminatedWithSchedule = await this.prisma.employment.findMany({ where: { tenantId, organizationId, employmentStatus: 'TERMINATED' } });
    for (const e of terminatedWithSchedule) {
      const openSchedule = await this.prisma.workScheduleAssignment.findFirst({ where: { tenantId, employmentId: e.id, effectiveTo: null } });
      if (openSchedule) issues.push({ code: 'TERMINATED_EMPLOYEE_ACTIVE_SCHEDULE', severity: 'ERROR', employmentId: e.id, message: `Terminated employment ${e.id} still has an open work schedule assignment.` });
    }

    return issues;
  }
}
