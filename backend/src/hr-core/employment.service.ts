import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface EmploymentStateSnapshot {
  employmentId: string;
  asOfDate: Date;
  status: string | null;
  organizationId: string | null;
  departmentId: string | null;
  branchId: string | null;
  positionId: string | null;
  staffingPositionId: string | null;
  managerEmploymentId: string | null;
  locationWarehouseId: string | null;
  fte: string | null;
  costCenterId: string | null;
}

/**
 * EmploymentService — read/query side of Employment (docx spec Phase 17
 * sections 1, 22-23). `getState()` is the as-of-date query engine: it
 * resolves EmployeeAssignment/EmploymentStatusHistory rows effective as of
 * a given date, which is the AUTHORITATIVE answer to "what was true on
 * date X" — Employment's own department/position/status fields are only a
 * best-effort CURRENT-STATE projection, refreshed by write actions (hire
 * post/transfer/terminate) and by `syncStatus()` (disclosed simplification:
 * no scheduled job flips a future-dated PLANNED employment to ACTIVE
 * automatically on its hire date — call `syncStatus()`, e.g. from a daily
 * report/health check, to refresh the projection for a specific employment
 * without waiting for its next write action).
 */
@Injectable()
export class EmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    status?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.employment.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: {
        employee: { include: { physicalPerson: true } },
        position: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.employment.findFirst({
      where: { id, organizationId },
      include: {
        employee: { include: { physicalPerson: true } },
        position: true,
        contract: true,
      },
    });
    if (!row) throw new NotFoundAppError('Employment', id);
    return row;
  }

  async getHistory(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.get(tenantId, membershipId, organizationId, id);
    const [assignments, statusHistory, transfers, workSchedules] =
      await Promise.all([
        this.prisma.employeeAssignment.findMany({
          where: { employmentId: id },
          orderBy: { effectiveFrom: 'asc' },
        }),
        this.prisma.employmentStatusHistory.findMany({
          where: { employmentId: id },
          orderBy: { effectiveFrom: 'asc' },
        }),
        this.prisma.employeeTransfer.findMany({
          where: { employmentId: id },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.workScheduleAssignment.findMany({
          where: { employmentId: id },
          orderBy: { effectiveFrom: 'asc' },
        }),
      ]);
    return { assignments, statusHistory, transfers, workSchedules };
  }

  /** As-of-date query engine (spec sections 22-23). Pass `tx` when calling
   * from inside another transaction that just wrote a checkpoint this same
   * query needs to see. */
  async getState(
    employmentId: string,
    asOfDate: Date,
    client?: PrismaTransactionClient,
  ): Promise<EmploymentStateSnapshot> {
    const db = client ?? this.prisma;
    const [assignment, statusRow] = await Promise.all([
      db.employeeAssignment.findFirst({
        where: {
          employmentId,
          effectiveFrom: { lte: asOfDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      }),
      db.employmentStatusHistory.findFirst({
        where: {
          employmentId,
          effectiveFrom: { lte: asOfDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    return {
      employmentId,
      asOfDate,
      status: statusRow?.status ?? null,
      organizationId: assignment?.organizationId ?? null,
      departmentId: assignment?.departmentId ?? null,
      branchId: assignment?.branchId ?? null,
      positionId: assignment?.positionId ?? null,
      staffingPositionId: assignment?.staffingPositionId ?? null,
      managerEmploymentId: assignment?.managerEmploymentId ?? null,
      locationWarehouseId: assignment?.locationWarehouseId ?? null,
      fte: assignment?.fte?.toString() ?? null,
      costCenterId: assignment?.costCenterId ?? null,
    };
  }

  /** Recomputes Employment's current-state projection fields from the
   * as-of-today assignment/status history and writes them back if stale. */
  async syncStatus(tenantId: string, organizationId: string, id: string) {
    const employment = await this.prisma.employment.findFirst({
      where: { id, organizationId, tenantId },
    });
    if (!employment) throw new NotFoundAppError('Employment', id);

    const state = await this.getState(id, new Date());
    if (!state.status || state.status === employment.status) return employment;

    return this.prisma.employment.update({
      where: { id },
      data: {
        status: state.status,
        departmentId: state.departmentId ?? employment.departmentId,
        positionId: state.positionId ?? employment.positionId,
        branchId: state.branchId,
        staffingPositionId: state.staffingPositionId,
        managerEmploymentId: state.managerEmploymentId,
        locationWarehouseId: state.locationWarehouseId,
        costCenterId: state.costCenterId,
        fte: state.fte ?? employment.fte,
        version: { increment: 1 },
      },
    });
  }
}
