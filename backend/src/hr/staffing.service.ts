import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreatePositionDto, CreateStaffingPositionDto, CreateStaffingTableDto, CreateWorkScheduleDto, UpdatePositionDto, UpdateStaffingPositionDto, UpdateWorkScheduleDto } from './dto/hr.dto';
import { HrDocType, HrEventType } from './hr.constants';
import { addDays, fmtHr, isoHr, parseHrDate, parseOptionalHrDate, rangesOverlapHr, todayHr } from './hr-date.util';
import { HrEventService } from './hr-event.service';

/** Position (generic job title, spec 13) and the minimal work-schedule
 * reference catalog (spec 32; full mechanics Phase 18). */
@Injectable()
export class HrMasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listPositions(tenantId: string, active?: string) {
    return this.prisma.hrPosition.findMany({ where: { tenantId, ...(active !== undefined ? { active: active === 'true' } : {}) }, orderBy: { code: 'asc' } });
  }

  async createPosition(tenantId: string, userId: string, dto: CreatePositionDto) {
    const exists = await this.prisma.hrPosition.findUnique({ where: { tenantId_code: { tenantId, code: dto.code } } });
    if (exists) throw new ConflictAppError(`Position code already exists: ${dto.code}`);
    const row = await this.prisma.hrPosition.create({ data: { tenantId, ...dto, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_POSITION_CREATED', entityType: 'HR_POSITION', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async updatePosition(tenantId: string, userId: string, id: string, dto: UpdatePositionDto) {
    const current = await this.prisma.hrPosition.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundAppError('Position', id);
    const row = await this.prisma.hrPosition.update({ where: { id }, data: { ...dto, version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'HR_POSITION_CHANGED', entityType: 'HR_POSITION', entityId: id, action: 'UPDATE', userId, oldValues: current, newValues: dto });
    return row;
  }

  listSchedules(tenantId: string) {
    return this.prisma.hrWorkSchedule.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async createSchedule(tenantId: string, userId: string, dto: CreateWorkScheduleDto) {
    const exists = await this.prisma.hrWorkSchedule.findUnique({ where: { tenantId_code: { tenantId, code: dto.code } } });
    if (exists) throw new ConflictAppError(`Work schedule code already exists: ${dto.code}`);
    const row = await this.prisma.hrWorkSchedule.create({ data: { tenantId, ...dto, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_WORK_SCHEDULE_CREATED', entityType: 'HR_WORK_SCHEDULE', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async updateSchedule(tenantId: string, userId: string, id: string, dto: UpdateWorkScheduleDto) {
    const current = await this.prisma.hrWorkSchedule.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundAppError('WorkSchedule', id);
    const row = await this.prisma.hrWorkSchedule.update({ where: { id }, data: { ...dto, version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'HR_WORK_SCHEDULE_CHANGED', entityType: 'HR_WORK_SCHEDULE', entityId: id, action: 'UPDATE', userId, oldValues: current, newValues: dto });
    return row;
  }
}

/**
 * StaffingTableService + StaffingPositionService (spec 14-17/82). A staffing
 * table is an effective-dated VERSION of an organization's structure;
 * activating a new version supersedes the previous one from the day before
 * its start (historical reports keep using the version valid on their date).
 * A StaffingPosition's `code` is its identity across versions.
 */
@Injectable()
export class StaffingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly events: HrEventService,
  ) {}

  async listTables(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.staffingTable.findMany({ where: { tenantId, organizationId }, orderBy: { effectiveFrom: 'desc' }, include: { _count: { select: { positions: true } } } });
  }

  async getTable(tenantId: string, membershipId: string, id: string) {
    const table = await this.prisma.staffingTable.findFirst({
      where: { id, tenantId },
      include: { positions: { include: { department: { select: { code: true, name: true } }, position: { select: { code: true, name: true } } }, orderBy: { code: 'asc' } } },
    });
    if (!table) throw new NotFoundAppError('StaffingTable', id);
    await this.access.assertAccess(tenantId, membershipId, table.organizationId);
    return table;
  }

  async createTable(tenantId: string, membershipId: string, userId: string, dto: CreateStaffingTableDto) {
    await this.access.assertAccess(tenantId, membershipId, dto.organizationId);
    const effectiveFrom = parseHrDate(dto.effectiveFrom, 'effectiveFrom');
    const last = await this.prisma.staffingTable.findFirst({ where: { tenantId, organizationId: dto.organizationId }, orderBy: { versionNumber: 'desc' } });
    return this.prisma.runInTransaction(async (tx) => {
      const table = await tx.staffingTable.create({
        data: { tenantId, organizationId: dto.organizationId, name: dto.name, effectiveFrom, versionNumber: (last?.versionNumber ?? 0) + 1, previousTableId: dto.copyFromTableId ?? null, createdBy: userId },
      });
      if (dto.copyFromTableId) {
        const source = await tx.staffingTable.findFirst({ where: { id: dto.copyFromTableId, tenantId, organizationId: dto.organizationId }, include: { positions: true } });
        if (!source) throw new ValidationAppError('copyFromTableId must be a staffing table of the same organization');
        for (const p of source.positions.filter((x) => x.status === 'ACTIVE' && (!x.activeTo || x.activeTo >= effectiveFrom))) {
          await tx.staffingPosition.create({
            data: {
              tenantId,
              staffingTableId: table.id,
              organizationId: p.organizationId,
              code: p.code,
              departmentId: p.departmentId,
              branchId: p.branchId,
              positionId: p.positionId,
              grade: p.grade,
              headcountLimit: p.headcountLimit,
              fteLimit: p.fteLimit,
              salaryRangeReference: p.salaryRangeReference,
              defaultWorkScheduleId: p.defaultWorkScheduleId,
              location: p.location,
              costCenter: p.costCenter,
              activeFrom: effectiveFrom,
              createdBy: userId,
            },
          });
        }
      }
      await this.audit.record({ tenantId, eventType: 'HR_STAFFING_TABLE_CREATED', entityType: HrDocType.STAFFING_TABLE, entityId: table.id, action: 'CREATE', userId, newValues: { name: dto.name, effectiveFrom: dto.effectiveFrom, versionNumber: table.versionNumber } }, tx);
      return table;
    });
  }

  /** DRAFT -> ACTIVE. The ACTIVE table covering the new start date is
   * superseded (effectiveTo = start - 1); overlapping later versions block. */
  async activateTable(tenantId: string, membershipId: string, userId: string, id: string) {
    const table = await this.getTable(tenantId, membershipId, id);
    if (table.status !== 'DRAFT') throw new ValidationAppError(`Only a DRAFT staffing table can be activated (status ${table.status})`);
    return this.prisma.runInTransaction(async (tx) => {
      const others = await tx.staffingTable.findMany({ where: { tenantId, organizationId: table.organizationId, status: 'ACTIVE', id: { not: id } } });
      for (const o of others) {
        if (o.effectiveFrom >= table.effectiveFrom) {
          throw new ConflictAppError(`Staffing table '${o.name}' is already active from ${fmtHr(o.effectiveFrom)}, on/after this version's start ${fmtHr(table.effectiveFrom)}`);
        }
        if (rangesOverlapHr(o.effectiveFrom, o.effectiveTo, table.effectiveFrom, null)) {
          await tx.staffingTable.update({ where: { id: o.id }, data: { effectiveTo: addDays(table.effectiveFrom, -1), status: 'SUPERSEDED', version: { increment: 1 } } });
        }
      }
      const updated = await tx.staffingTable.update({ where: { id }, data: { status: 'ACTIVE', approvedAt: new Date(), approvedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'HR_STAFFING_TABLE_ACTIVATED', entityType: HrDocType.STAFFING_TABLE, entityId: id, action: 'ACTIVATE', userId, newValues: { effectiveFrom: isoHr(table.effectiveFrom) } }, tx);
      return updated;
    });
  }

  async createPosition(tenantId: string, membershipId: string, userId: string, dto: CreateStaffingPositionDto) {
    const table = await this.prisma.staffingTable.findFirst({ where: { id: dto.staffingTableId, tenantId } });
    if (!table) throw new NotFoundAppError('StaffingTable', dto.staffingTableId);
    await this.access.assertAccess(tenantId, membershipId, table.organizationId);
    if (['SUPERSEDED', 'CANCELLED'].includes(table.status)) throw new ValidationAppError(`Cannot add positions to a ${table.status} staffing table`);
    const dep = await this.prisma.department.findFirst({ where: { id: dto.departmentId, organizationId: table.organizationId } });
    if (!dep) throw new ValidationAppError('Department does not belong to the staffing table organization');
    const pos = await this.prisma.hrPosition.findFirst({ where: { id: dto.positionId, tenantId } });
    if (!pos) throw new ValidationAppError('Position not found');
    if (dto.branchId && !(await this.prisma.branch.findFirst({ where: { id: dto.branchId, organizationId: table.organizationId } }))) throw new ValidationAppError('Branch does not belong to the organization');
    const exists = await this.prisma.staffingPosition.findUnique({ where: { staffingTableId_code: { staffingTableId: table.id, code: dto.code } } });
    if (exists) throw new ConflictAppError(`Staffing position code already exists in this table: ${dto.code}`);
    const activeFrom = parseOptionalHrDate(dto.activeFrom, 'activeFrom') ?? table.effectiveFrom;
    const row = await this.prisma.staffingPosition.create({
      data: {
        tenantId,
        staffingTableId: table.id,
        organizationId: table.organizationId,
        code: dto.code,
        departmentId: dto.departmentId,
        branchId: dto.branchId,
        positionId: dto.positionId,
        grade: dto.grade,
        headcountLimit: dto.headcountLimit,
        fteLimit: dto.fteLimit,
        salaryRangeReference: dto.salaryRangeReference,
        defaultWorkScheduleId: dto.defaultWorkScheduleId,
        location: dto.location,
        costCenter: dto.costCenter,
        activeFrom,
        activeTo: parseOptionalHrDate(dto.activeTo, 'activeTo'),
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'HR_STAFFING_POSITION_CREATED', entityType: HrDocType.STAFFING_POSITION, entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async updatePosition(tenantId: string, membershipId: string, userId: string, id: string, dto: UpdateStaffingPositionDto) {
    const current = await this.prisma.staffingPosition.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundAppError('StaffingPosition', id);
    await this.access.assertAccess(tenantId, membershipId, current.organizationId);
    const data: Record<string, unknown> = { ...dto };
    if ('activeTo' in dto) data.activeTo = parseOptionalHrDate(dto.activeTo, 'activeTo');
    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.staffingPosition.update({ where: { id }, data: { ...(data as any), version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'HR_STAFFING_POSITION_CHANGED', entityType: HrDocType.STAFFING_POSITION, entityId: id, action: 'UPDATE', userId, oldValues: current, newValues: dto }, tx);
      await this.events.emit(tx, {
        tenantId,
        eventType: HrEventType.STAFFING_POSITION_CHANGED,
        organizationId: current.organizationId,
        effectiveDate: todayHr(),
        oldState: { headcountLimit: current.headcountLimit, fteLimit: current.fteLimit.toString(), status: current.status, activeTo: isoHr(current.activeTo) },
        newState: { headcountLimit: row.headcountLimit, fteLimit: row.fteLimit.toString(), status: row.status, activeTo: isoHr(row.activeTo) },
        sourceDocumentType: HrDocType.STAFFING_POSITION,
        sourceDocumentId: id,
        keySuffix: String(row.version),
      });
      return row;
    });
  }

  async listPositions(tenantId: string, membershipId: string, organizationId: string, asOfRaw?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asOf = parseOptionalHrDate(asOfRaw, 'asOf');
    return this.prisma.staffingPosition.findMany({
      where: {
        tenantId,
        organizationId,
        ...(asOf
          ? {
              status: 'ACTIVE',
              activeFrom: { lte: asOf },
              OR: [{ activeTo: null }, { activeTo: { gte: asOf } }],
              staffingTable: { status: { in: ['ACTIVE', 'SUPERSEDED'] }, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] },
            }
          : {}),
      },
      include: { department: { select: { code: true, name: true } }, position: { select: { code: true, name: true } }, staffingTable: { select: { name: true, versionNumber: true, status: true } } },
      orderBy: { code: 'asc' },
    });
  }
}
