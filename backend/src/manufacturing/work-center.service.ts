import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** WorkCenterService (spec sections 20-22). `WorkCenterGroup` is folded
 * into a plain `groupCode` string on the work center itself — a full
 * Capacity/APS engine (available vs planned vs actual load) is NOT built
 * in this pass beyond the static `capacityHoursPerDay` field (disclosed
 * simplification, see docs/MANUFACTURING.md). */
@Injectable()
export class WorkCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { code: string; name: string; departmentId?: string; groupCode?: string; costCenterId?: string; capacityHoursPerDay?: number; hourlyMachineRate?: number }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.workCenter.create({ data: { tenantId, organizationId, code: dto.code, name: dto.name, departmentId: dto.departmentId, groupCode: dto.groupCode, costCenterId: dto.costCenterId, capacityHoursPerDay: (dto.capacityHoursPerDay ?? 8).toString(), hourlyMachineRate: dto.hourlyMachineRate?.toString(), createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'WORK_CENTER_CREATED', entityType: 'WORK_CENTER', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.workCenter.findMany({ where: { tenantId, organizationId, active: true } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.workCenter.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('WorkCenter', id);
    return row;
  }

  /** Capacity foundation (spec section 22) — planned load computed live
   * from OperationExecution rows scheduled against the work center for
   * `date`, never a stored counter. */
  async capacityForDate(tenantId: string, workCenterId: string, date: Date) {
    const wc = await this.prisma.workCenter.findFirstOrThrow({ where: { id: workCenterId, tenantId } });
    const executions = await this.prisma.operationExecution.findMany({ where: { tenantId, workCenterId, executionDate: date, status: { notIn: ['CANCELLED'] } } });
    const plannedLoad = executions.reduce((s, e) => s + Number(e.laborHours.toString()) + Number(e.machineHours.toString()), 0);
    return { availableHours: Number(wc.capacityHoursPerDay.toString()), plannedLoad, remainingCapacity: Number(wc.capacityHoursPerDay.toString()) - plannedLoad };
  }
}
