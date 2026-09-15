import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/** WorkTimeReportingService (spec section 83: Norm vs Actual). */
@Injectable()
export class WorkTimeReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async normVsActual(tenantId: string, membershipId: string, organizationId: string, timesheetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const lines = await this.prisma.timesheetLine.findMany({ where: { tenantId, timesheet: { id: timesheetId, organizationId } }, include: { employment: { include: { employee: { include: { physicalPerson: true } } } } } });
    const byEmployment = new Map<string, { employee: string; planned: Decimal; worked: Decimal; paidNonWorked: Decimal; unpaid: Decimal; overtime: Decimal }>();
    for (const l of lines) {
      const key = l.employmentId;
      const entry = byEmployment.get(key) ?? { employee: l.employment.employee.physicalPerson.fullName, planned: new Decimal(0), worked: new Decimal(0), paidNonWorked: new Decimal(0), unpaid: new Decimal(0), overtime: new Decimal(0) };
      entry.planned = entry.planned.plus(l.plannedHours.toString());
      entry.worked = entry.worked.plus(l.regularHours.toString());
      entry.paidNonWorked = entry.paidNonWorked.plus(l.paidHours.toString()).minus(l.regularHours.toString()).minus(l.overtimeHours.toString());
      entry.unpaid = entry.unpaid.plus(l.unpaidHours.toString());
      entry.overtime = entry.overtime.plus(l.overtimeHours.toString());
      byEmployment.set(key, entry);
    }
    return [...byEmployment.values()].map((e) => ({ employee: e.employee, plannedHours: e.planned.toString(), workedHours: e.worked.toString(), paidNonWorkedHours: Decimal.max(e.paidNonWorked, 0).toString(), unpaidHours: e.unpaid.toString(), overtimeHours: e.overtime.toString(), variance: e.worked.plus(e.overtime).minus(e.planned).toString() }));
  }

  async timesheetSummary(tenantId: string, membershipId: string, organizationId: string, timesheetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const lines = await this.prisma.timesheetLine.findMany({ where: { tenantId, timesheet: { id: timesheetId, organizationId } } });
    const sum = (field: 'plannedHours' | 'regularHours' | 'overtimeHours' | 'nightHours' | 'holidayHours' | 'weekendHours' | 'leaveHours' | 'absenceHours') => lines.reduce((s, l) => s.plus(l[field].toString()), new Decimal(0)).toString();
    return { plannedHours: sum('plannedHours'), regularHours: sum('regularHours'), overtimeHours: sum('overtimeHours'), nightHours: sum('nightHours'), holidayHours: sum('holidayHours'), weekendHours: sum('weekendHours'), leaveHours: sum('leaveHours'), absenceHours: sum('absenceHours') };
  }
}
