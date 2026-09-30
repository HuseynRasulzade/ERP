import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RequestContextService } from '../common/context/request-context.service';
import { PermissionCodes } from '../rbac/permission-codes';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { PhysicalPersonService } from './physical-person.service';
import { EmployeeService } from './employee.service';
import { StaffingTableService } from './staffing-table.service';
import { ApprovalService } from '../approvals/approval.service';
import { CreateHireDocumentDto, PostHireDocumentDto } from './dto/hr-core.dto';

export const HIRE_DOCUMENT_TYPE = 'HR_HIRE_DOCUMENT';

/**
 * HireDocumentService (docx spec Phase 17 sections 19-21, 48) — the single
 * entry point that creates Employment + the initial EmployeeAssignment +
 * EmploymentStatusHistory checkpoints. Also the Rehire path via
 * `rehireOfEmployeeId` (spec section 48): reuses the existing Employee row,
 * never creates a duplicate.
 *
 * Employee resolution happens at CREATE time (not post time) because
 * HireDocument.employeeId is a required field — the document always names
 * a concrete Employee, new or existing, the moment it's drafted.
 */
@Injectable()
export class HireDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly requestContext: RequestContextService,
    private readonly persons: PhysicalPersonService,
    private readonly employees: EmployeeService,
    private readonly staffingTables: StaffingTableService,
    private readonly approvals: ApprovalService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    status?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.hireDocument.findMany({
          where: { organizationId, ...(status ? { status } : {}) },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.hireDocument.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('HireDocument', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateHireDocumentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const providedTargets = [
      dto.employeeId,
      dto.rehireOfEmployeeId,
      dto.newPerson,
    ].filter((v) => v !== undefined).length;
    if (providedTargets !== 1)
      throw new ValidationAppError(
        'Provide exactly one of employeeId, rehireOfEmployeeId, or newPerson',
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
    if (dto.managerEmploymentId) {
      const manager = await this.prisma.employment.findFirst({
        where: { id: dto.managerEmploymentId, organizationId },
      });
      if (!manager)
        throw new ValidationAppError(
          'managerEmploymentId does not belong to this organization',
        );
    }

    const hireDate = this.parseDate(dto.hireDate);
    const fte = dto.fte ?? 1;

    if (dto.staffingPositionId) {
      const staffingPosition = await this.prisma.staffingPosition.findFirst({
        where: { id: dto.staffingPositionId, organizationId },
      });
      if (!staffingPosition)
        throw new ValidationAppError(
          'staffingPositionId does not belong to this organization',
        );
      const capacity = await this.staffingTables.checkCapacity(
        dto.staffingPositionId,
        fte,
      );
      if (!capacity.ok) {
        const canOverride = this.requestContext.hasPermission(
          PermissionCodes.HR_OVERRIDE_STAFFING_LIMIT,
        );
        if (!dto.overrideStaffingLimit || !canOverride)
          throw new ValidationAppError(
            `Staffing position is at capacity (${capacity.usedHeadcount}/${capacity.headcountLimit} headcount, ${capacity.usedFte}/${capacity.fteLimit} FTE)`,
          );
      }
    }

    return this.prisma.runInTransaction(async (tx) => {
      const employeeId = await this.resolveEmployeeId(
        tenantId,
        userId,
        dto,
        tx,
      );

      if (dto.employmentType === 'PRIMARY') {
        const existingPrimary = await tx.employment.findFirst({
          where: {
            employeeId,
            primaryEmployment: true,
            status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE'] },
          },
        });
        if (existingPrimary)
          throw new ValidationAppError(
            'This employee already has an open PRIMARY employment — terminate it first or hire as SECONDARY',
          );
      }

      const probationEndDate = dto.probationMonths
        ? this.addMonths(hireDate, dto.probationMonths)
        : undefined;

      const hireDocument = await tx.hireDocument.create({
        data: {
          tenantId,
          organizationId,
          employeeId,
          employmentType: dto.employmentType,
          hireDate,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          staffingPositionId: dto.staffingPositionId,
          branchId: dto.branchId,
          managerEmploymentId: dto.managerEmploymentId,
          workScheduleCode: dto.workScheduleCode,
          fte: new Decimal(fte),
          probationEndDate,
          locationWarehouseId: dto.locationWarehouseId,
          responsibleHrUserId: dto.responsibleHrUserId,
          rehireOfEmployeeId: dto.rehireOfEmployeeId,
          createdBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_HIRE_DOCUMENT_CREATED',
          entityType: HIRE_DOCUMENT_TYPE,
          entityId: hireDocument.id,
          action: 'CREATE',
          userId,
          newValues: { employeeId, hireDate: dto.hireDate },
        },
        tx,
      );

      await this.approvals.createStepsForDocument(tenantId, organizationId, HIRE_DOCUMENT_TYPE, hireDocument.id, tx);

      return tx.hireDocument.findFirst({ where: { id: hireDocument.id } });
    });
  }

  async post(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: PostHireDocumentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const hireDocument = await this.get(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
    if (hireDocument.status !== 'DRAFT')
      throw new ValidationAppError(
        `Cannot post a hire document in status ${hireDocument.status}`,
      );
    if (
      hireDocument.approvalStatus !== 'APPROVED' &&
      hireDocument.approvalStatus !== 'NOT_REQUIRED'
    )
      throw new ValidationAppError(
        `Cannot post a hire document with approval status ${hireDocument.approvalStatus}`,
      );
    if (hireDocument.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      const status = hireDocument.hireDate <= new Date() ? 'ACTIVE' : 'PLANNED';

      const employment = await tx.employment.create({
        data: {
          tenantId,
          employeeId: hireDocument.employeeId,
          organizationId,
          employmentType: hireDocument.employmentType,
          employmentStartDate: hireDocument.hireDate,
          primaryEmployment: hireDocument.employmentType === 'PRIMARY',
          staffingPositionId: hireDocument.staffingPositionId,
          departmentId: hireDocument.departmentId,
          positionId: hireDocument.positionId,
          branchId: hireDocument.branchId,
          managerEmploymentId: hireDocument.managerEmploymentId,
          workScheduleCode: hireDocument.workScheduleCode,
          fte: hireDocument.fte,
          probationEndDate: hireDocument.probationEndDate,
          locationWarehouseId: hireDocument.locationWarehouseId,
          status,
        },
      });

      await tx.employeeAssignment.create({
        data: {
          tenantId,
          employmentId: employment.id,
          effectiveFrom: hireDocument.hireDate,
          organizationId,
          departmentId: hireDocument.departmentId,
          branchId: hireDocument.branchId,
          positionId: hireDocument.positionId,
          staffingPositionId: hireDocument.staffingPositionId,
          managerEmploymentId: hireDocument.managerEmploymentId,
          locationWarehouseId: hireDocument.locationWarehouseId,
          fte: hireDocument.fte,
          reason: 'HIRE',
          sourceDocumentType: HIRE_DOCUMENT_TYPE,
          sourceDocumentId: hireDocument.id,
          createdBy: userId,
        },
      });

      await tx.employmentStatusHistory.create({
        data: {
          tenantId,
          employmentId: employment.id,
          status: 'ACTIVE',
          effectiveFrom: hireDocument.hireDate,
          reason: 'HIRE',
          sourceDocumentType: HIRE_DOCUMENT_TYPE,
          sourceDocumentId: hireDocument.id,
        },
      });

      if (hireDocument.workScheduleCode) {
        await tx.workScheduleAssignment.create({
          data: {
            tenantId,
            employmentId: employment.id,
            workScheduleCode: hireDocument.workScheduleCode,
            effectiveFrom: hireDocument.hireDate,
            reason: 'HIRE',
            sourceDocumentType: HIRE_DOCUMENT_TYPE,
            sourceDocumentId: hireDocument.id,
          },
        });
      }

      const employee = await tx.employee.findFirst({
        where: { id: hireDocument.employeeId },
      });
      await tx.employee.update({
        where: { id: hireDocument.employeeId },
        data: {
          status: 'ACTIVE',
          hireFirstDate: employee?.hireFirstDate ?? hireDocument.hireDate,
        },
      });

      const result = await tx.hireDocument.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: {
          status: 'POSTED',
          employmentId: employment.id,
          postedAt: new Date(),
          postedBy: userId,
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_HIRE_DOCUMENT_POSTED',
          entityType: HIRE_DOCUMENT_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: { employmentId: employment.id },
        },
        tx,
      );

      return tx.hireDocument.findFirst({ where: { id } });
    });
  }

  // -- Approval -----------------------------------------------------------------

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    comment?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.approve(tenantId, organizationId, HIRE_DOCUMENT_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reject(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    comment?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.reject(tenantId, organizationId, HIRE_DOCUMENT_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private async resolveEmployeeId(
    tenantId: string,
    userId: string,
    dto: CreateHireDocumentDto,
    tx: PrismaTransactionClient,
  ): Promise<string> {
    if (dto.employeeId) {
      const employee = await tx.employee.findFirst({
        where: { id: dto.employeeId, tenantId },
      });
      if (!employee)
        throw new ValidationAppError(
          'employeeId does not belong to this tenant',
        );
      return employee.id;
    }
    if (dto.rehireOfEmployeeId) {
      const employee = await tx.employee.findFirst({
        where: { id: dto.rehireOfEmployeeId, tenantId },
      });
      if (!employee)
        throw new ValidationAppError(
          'rehireOfEmployeeId does not belong to this tenant',
        );
      const openEmployment = await tx.employment.findFirst({
        where: {
          employeeId: employee.id,
          status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE'] },
        },
      });
      if (openEmployment)
        throw new ValidationAppError(
          'This employee still has an open employment — use a transfer, not a rehire',
        );
      return employee.id;
    }
    if (dto.newPerson) {
      const person = await this.persons.create(
        tenantId,
        userId,
        dto.newPerson,
        tx,
      );
      const employee = await this.employees.create(
        tenantId,
        userId,
        { physicalPersonId: person.id },
        tx,
      );
      return employee.id;
    }
    throw new ValidationAppError('No employee target resolved');
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()),
    );
  }
}
