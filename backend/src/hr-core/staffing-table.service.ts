import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  ActivateStaffingTableDto,
  AddStaffingPositionDto,
  CreateStaffingTableDto,
} from './dto/hr-core.dto';

const STAFFING_TABLE_TYPE = 'HR_STAFFING_TABLE';

/**
 * StaffingTable / StaffingPosition — versioned planned org structure (docx
 * spec Phase 17 sections 15-18). A StaffingPosition is a specific planned
 * seat (department + position + headcount/FTE limit); HireDocumentService
 * and EmployeeTransferService check capacity against the organization's
 * currently ACTIVE table (disclosed simplification: capacity is checked
 * against the table active as of TODAY, not the hire/transfer's own
 * effective date — a future-dated staffing table change is not
 * anticipated).
 */
@Injectable()
export class StaffingTableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.staffingTable.findMany({
      where: { organizationId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.staffingTable.findFirst({
      where: { id, organizationId },
      include: { positions: true },
    });
    if (!row) throw new NotFoundAppError('StaffingTable', id);
    return row;
  }

  async getActive(tenantId: string, organizationId: string) {
    return this.prisma.staffingTable.findFirst({
      where: { organizationId, status: 'ACTIVE' },
      include: { positions: true },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateStaffingTableDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const table = await this.prisma.staffingTable.create({
      data: {
        tenantId,
        organizationId,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        createdBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'HR_STAFFING_TABLE_CREATED',
      entityType: STAFFING_TABLE_TYPE,
      entityId: table.id,
      action: 'CREATE',
      userId,
    });
    return table;
  }

  async addPosition(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    staffingTableId: string,
    dto: AddStaffingPositionDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const table = await this.prisma.staffingTable.findFirst({
      where: { id: staffingTableId, organizationId },
    });
    if (!table) throw new NotFoundAppError('StaffingTable', staffingTableId);
    if (table.status !== 'DRAFT')
      throw new ValidationAppError(
        'Cannot add positions to a table that is no longer DRAFT',
      );

    const department = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, organizationId },
    });
    if (!department)
      throw new ValidationAppError(
        'departmentId does not belong to this organization',
      );
    const position = await this.prisma.position.findFirst({
      where: { id: dto.positionId, tenantId },
    });
    if (!position)
      throw new ValidationAppError('positionId does not belong to this tenant');

    return this.prisma.staffingPosition.create({
      data: {
        tenantId,
        staffingTableId,
        organizationId,
        departmentId: dto.departmentId,
        branchId: dto.branchId,
        positionId: dto.positionId,
        grade: dto.grade,
        headcountLimit: dto.headcountLimit ?? 1,
        fteLimit: dto.fteLimit ?? 1,
        salaryRangeReference: dto.salaryRangeReference,
        workScheduleDefault: dto.workScheduleDefault,
        locationWarehouseId: dto.locationWarehouseId,
        costCenterId: dto.costCenterId,
        activeFrom: this.parseDate(dto.activeFrom),
        createdBy: userId,
      },
    });
  }

  /** Activates a DRAFT table, superseding any currently ACTIVE table for
   * the same organization (closes it as of the new table's effectiveFrom). */
  async activate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ActivateStaffingTableDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const table = await this.prisma.staffingTable.findFirst({
      where: { id, organizationId },
    });
    if (!table) throw new NotFoundAppError('StaffingTable', id);
    if (table.status !== 'DRAFT')
      throw new ValidationAppError(
        `Cannot activate a table in status ${table.status}`,
      );
    if (table.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      await tx.staffingTable.updateMany({
        where: { organizationId, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', effectiveTo: table.effectiveFrom },
      });
      const result = await tx.staffingTable.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_STAFFING_TABLE_ACTIVATED',
          entityType: STAFFING_TABLE_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
        },
        tx,
      );
      return tx.staffingTable.findFirst({
        where: { id },
        include: { positions: true },
      });
    });
  }

  /** Headcount/FTE capacity check for a staffing position (spec section
   * 17) — counts currently ACTIVE/PLANNED employments against it. */
  async checkCapacity(
    staffingPositionId: string,
    additionalFte: number,
  ): Promise<{
    ok: boolean;
    usedHeadcount: number;
    usedFte: number;
    headcountLimit: number;
    fteLimit: number;
  }> {
    const position = await this.prisma.staffingPosition.findFirst({
      where: { id: staffingPositionId },
    });
    if (!position)
      throw new NotFoundAppError('StaffingPosition', staffingPositionId);

    const employments = await this.prisma.employment.findMany({
      where: {
        staffingPositionId,
        status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE'] },
      },
    });
    const usedHeadcount = employments.length;
    const usedFte = employments.reduce((sum, e) => sum + Number(e.fte), 0);
    const headcountLimit = Number(position.headcountLimit);
    const fteLimit = Number(position.fteLimit);

    const ok =
      usedHeadcount + 1 <= headcountLimit &&
      usedFte + additionalFte <= fteLimit + 0.0001;
    return { ok, usedHeadcount, usedFte, headcountLimit, fteLimit };
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
