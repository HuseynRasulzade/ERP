import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * StaffingService (spec sections 14-18, 82). `capacity` is always
 * computed live from `EmployeeAssignment.fte` grouped by
 * `staffingPositionId` (spec section 17 — headcount limit vs occupied FTE
 * vs vacancy) — never a stored counter that could drift.
 */
@Injectable()
export class StaffingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async createTable(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { effectiveFrom: string; supersedesTableId?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      if (dto.supersedesTableId) {
        await tx.staffingTable.update({ where: { id: dto.supersedesTableId }, data: { status: 'SUPERSEDED', effectiveTo: new Date(new Date(dto.effectiveFrom).getTime() - 86_400_000) } });
      }
      const row = await tx.staffingTable.create({ data: { tenantId, organizationId, effectiveFrom: new Date(dto.effectiveFrom), status: 'ACTIVE', createdBy: userId } });
      await this.audit.record({ tenantId, eventType: 'HR_STAFFING_TABLE_CREATED', entityType: 'STAFFING_TABLE', entityId: row.id, action: 'CREATE', userId, newValues: dto }, tx);
      return row;
    });
  }

  async addPosition(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { staffingTableId: string; departmentId: string; branchId?: string; positionId: string; grade?: string; headcountLimit?: number; fteLimit?: number; salaryRangeReference?: string; workScheduleDefault?: string; locationId?: string; costCenterId?: string; activeFrom: string; overstaffPolicy?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.staffingPosition.create({
      data: {
        tenantId,
        staffingTableId: dto.staffingTableId,
        organizationId,
        departmentId: dto.departmentId,
        branchId: dto.branchId,
        positionId: dto.positionId,
        grade: dto.grade,
        headcountLimit: dto.headcountLimit ?? 1,
        fteLimit: (dto.fteLimit ?? 1).toString(),
        salaryRangeReference: dto.salaryRangeReference,
        workScheduleDefault: dto.workScheduleDefault,
        locationId: dto.locationId,
        costCenterId: dto.costCenterId,
        activeFrom: new Date(dto.activeFrom),
        overstaffPolicy: dto.overstaffPolicy ?? 'WARNING',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'HR_STAFFING_POSITION_CREATED', entityType: 'STAFFING_POSITION', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  /** Staffing Capacity (spec section 17) + Staffing Report (spec section 89). */
  async capacity(tenantId: string, membershipId: string, organizationId: string, staffingPositionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const position = await this.prisma.staffingPosition.findFirst({ where: { id: staffingPositionId, tenantId } });
    if (!position) throw new NotFoundAppError('StaffingPosition', staffingPositionId);
    const activeAssignments = await this.prisma.employeeAssignment.findMany({ where: { tenantId, staffingPositionId, effectiveTo: null } });
    const occupiedFte = activeAssignments.reduce((s, a) => s.plus(a.fte.toString()), new Decimal(0));
    const vacantFte = new Decimal(position.fteLimit.toString()).minus(occupiedFte);
    return { staffingPositionId, headcountLimit: position.headcountLimit, approvedFte: position.fteLimit.toString(), occupiedHeadcount: activeAssignments.length, occupiedFte: occupiedFte.toString(), vacantFte: (vacantFte.lt(0) ? new Decimal(0) : vacantFte).toString(), overstaffed: occupiedFte.gt(position.fteLimit.toString()) };
  }

  /** Checked at hire/transfer time (spec sections 18, 68). Returns a
   * decision string rather than throwing directly so the caller applies
   * `overstaffPolicy` (BLOCK throws, WARNING/APPROVAL_REQUIRED/ALLOW don't). */
  async checkOverstaff(tenantId: string, staffingPositionId: string, incomingFte: Decimal): Promise<{ policy: string; wouldExceed: boolean; vacantFte: string }> {
    const position = await this.prisma.staffingPosition.findFirst({ where: { id: staffingPositionId, tenantId } });
    if (!position) throw new ValidationAppError('Unknown staffing position');
    if (position.status !== 'ACTIVE') throw new ValidationAppError('Cannot assign to a closed staffing position');
    const activeAssignments = await this.prisma.employeeAssignment.findMany({ where: { tenantId, staffingPositionId, effectiveTo: null } });
    const occupiedFte = activeAssignments.reduce((s, a) => s.plus(a.fte.toString()), new Decimal(0));
    const projected = occupiedFte.plus(incomingFte);
    const limit = new Decimal(position.fteLimit.toString());
    const wouldExceed = projected.gt(limit) || activeAssignments.length + 1 > position.headcountLimit;
    if (wouldExceed && position.overstaffPolicy === 'BLOCK') throw new ValidationAppError(`Staffing position capacity exceeded (limit ${limit.toString()} FTE / ${position.headcountLimit} headcount, occupied ${occupiedFte.toString()}).`);
    return { policy: position.overstaffPolicy, wouldExceed, vacantFte: limit.minus(occupiedFte).toString() };
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.staffingPosition.findMany({ where: { tenantId, organizationId, status: 'ACTIVE' }, include: { department: true, position: true } }));
  }
}
