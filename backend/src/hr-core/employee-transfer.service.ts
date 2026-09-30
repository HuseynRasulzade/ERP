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
import { StaffingTableService } from './staffing-table.service';
import { ApprovalService } from '../approvals/approval.service';
import {
  CreateEmployeeTransferDto,
  PostEmployeeTransferDto,
} from './dto/hr-core.dto';

export const TRANSFER_TYPE = 'HR_EMPLOYEE_TRANSFER';
const MAX_HIERARCHY_DEPTH = 50;

/**
 * EmployeeTransfer (docx spec Phase 17 sections 24-28) — the document that
 * creates a new EmployeeAssignment checkpoint. Future-dated transfers are
 * supported: posting always closes the assignment covering `effectiveDate`
 * and opens a new one from that date, but the Employment live-projection
 * fields are only refreshed immediately when `effectiveDate` is today or
 * earlier — a future-dated transfer's projection catches up via
 * `EmploymentService.syncStatus()` (same disclosed simplification as
 * HireDocumentService's own future-dated hire handling).
 */
@Injectable()
export class EmployeeTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly requestContext: RequestContextService,
    private readonly staffingTables: StaffingTableService,
    private readonly approvals: ApprovalService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    employmentId?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.employeeTransfer.findMany({
          where: { organizationId, ...(employmentId ? { employmentId } : {}) },
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
    const row = await this.prisma.employeeTransfer.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('EmployeeTransfer', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateEmployeeTransferDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: dto.employmentId, organizationId },
    });
    if (!employment)
      throw new ValidationAppError(
        'employmentId does not belong to this organization',
      );
    if (['TERMINATED', 'CANCELLED'].includes(employment.status))
      throw new ValidationAppError(
        `Cannot transfer an employment in status ${employment.status}`,
      );

    if (dto.newDepartmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: dto.newDepartmentId, organizationId },
      });
      if (!department)
        throw new ValidationAppError(
          'newDepartmentId does not belong to this organization',
        );
    }
    if (dto.newPositionId) {
      const position = await this.prisma.position.findFirst({
        where: { id: dto.newPositionId, tenantId },
      });
      if (!position)
        throw new ValidationAppError(
          'newPositionId does not belong to this tenant',
        );
    }
    if (dto.newManagerEmploymentId) {
      if (dto.newManagerEmploymentId === dto.employmentId)
        throw new ValidationAppError('An employment cannot manage itself');
      const manager = await this.prisma.employment.findFirst({
        where: { id: dto.newManagerEmploymentId, organizationId },
      });
      if (!manager)
        throw new ValidationAppError(
          'newManagerEmploymentId does not belong to this organization',
        );
      await this.assertNoCycle(
        this.prisma,
        dto.newManagerEmploymentId,
        dto.employmentId,
      );
    }

    const fte = dto.newFte ?? Number(employment.fte);
    if (dto.newStaffingPositionId) {
      const staffingPosition = await this.prisma.staffingPosition.findFirst({
        where: { id: dto.newStaffingPositionId, organizationId },
      });
      if (!staffingPosition)
        throw new ValidationAppError(
          'newStaffingPositionId does not belong to this organization',
        );
      if (staffingPosition.id !== employment.staffingPositionId) {
        const capacity = await this.staffingTables.checkCapacity(
          dto.newStaffingPositionId,
          fte,
        );
        if (!capacity.ok) {
          const canOverride = this.requestContext.hasPermission(
            PermissionCodes.HR_OVERRIDE_STAFFING_LIMIT,
          );
          if (!dto.overrideStaffingLimit || !canOverride)
            throw new ValidationAppError(
              `Target staffing position is at capacity (${capacity.usedHeadcount}/${capacity.headcountLimit} headcount, ${capacity.usedFte}/${capacity.fteLimit} FTE)`,
            );
        }
      }
    }

    const effectiveDate = this.parseDate(dto.effectiveDate);
    return this.prisma.runInTransaction(async (tx) => {
      const transfer = await tx.employeeTransfer.create({
        data: {
          tenantId,
          organizationId,
          employmentId: dto.employmentId,
          transferType: dto.transferType,
          effectiveDate,
          newDepartmentId: dto.newDepartmentId,
          newPositionId: dto.newPositionId,
          newStaffingPositionId: dto.newStaffingPositionId,
          newBranchId: dto.newBranchId,
          newManagerEmploymentId: dto.newManagerEmploymentId,
          newLocationWarehouseId: dto.newLocationWarehouseId,
          newFte: dto.newFte !== undefined ? new Decimal(dto.newFte) : undefined,
          reason: dto.reason,
          createdBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_TRANSFER_CREATED',
          entityType: TRANSFER_TYPE,
          entityId: transfer.id,
          action: 'CREATE',
          userId,
        },
        tx,
      );

      await this.approvals.createStepsForDocument(tenantId, organizationId, TRANSFER_TYPE, transfer.id, tx);

      return tx.employeeTransfer.findFirst({ where: { id: transfer.id } });
    });
  }

  async post(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: PostEmployeeTransferDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const transfer = await this.get(tenantId, membershipId, organizationId, id);
    if (transfer.status !== 'DRAFT')
      throw new ValidationAppError(
        `Cannot post a transfer in status ${transfer.status}`,
      );
    if (
      transfer.approvalStatus !== 'APPROVED' &&
      transfer.approvalStatus !== 'NOT_REQUIRED'
    )
      throw new ValidationAppError(
        `Cannot post a transfer with approval status ${transfer.approvalStatus}`,
      );
    if (transfer.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { id: transfer.employmentId, organizationId },
      });
      if (!employment)
        throw new NotFoundAppError('Employment', transfer.employmentId);

      const current = await tx.employeeAssignment.findFirst({
        where: {
          employmentId: transfer.employmentId,
          effectiveFrom: { lte: transfer.effectiveDate },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: transfer.effectiveDate } },
          ],
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      const dayBefore = new Date(transfer.effectiveDate);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

      if (current) {
        await tx.employeeAssignment.update({
          where: { id: current.id },
          data: { effectiveTo: dayBefore },
        });
      }

      const newFte = transfer.newFte ?? current?.fte ?? employment.fte;
      await tx.employeeAssignment.create({
        data: {
          tenantId,
          employmentId: transfer.employmentId,
          effectiveFrom: transfer.effectiveDate,
          organizationId,
          departmentId:
            transfer.newDepartmentId ??
            current?.departmentId ??
            employment.departmentId,
          branchId:
            transfer.newBranchId ?? current?.branchId ?? employment.branchId,
          positionId:
            transfer.newPositionId ??
            current?.positionId ??
            employment.positionId,
          staffingPositionId:
            transfer.newStaffingPositionId ??
            current?.staffingPositionId ??
            employment.staffingPositionId,
          managerEmploymentId:
            transfer.newManagerEmploymentId ??
            current?.managerEmploymentId ??
            employment.managerEmploymentId,
          locationWarehouseId:
            transfer.newLocationWarehouseId ??
            current?.locationWarehouseId ??
            employment.locationWarehouseId,
          fte: newFte,
          costCenterId: current?.costCenterId ?? employment.costCenterId,
          reason: transfer.reason ?? transfer.transferType,
          sourceDocumentType: TRANSFER_TYPE,
          sourceDocumentId: transfer.id,
          createdBy: userId,
        },
      });

      if (transfer.effectiveDate <= new Date()) {
        await tx.employment.update({
          where: { id: transfer.employmentId },
          data: {
            departmentId: transfer.newDepartmentId ?? employment.departmentId,
            branchId: transfer.newBranchId ?? employment.branchId,
            positionId: transfer.newPositionId ?? employment.positionId,
            staffingPositionId:
              transfer.newStaffingPositionId ?? employment.staffingPositionId,
            managerEmploymentId:
              transfer.newManagerEmploymentId ?? employment.managerEmploymentId,
            locationWarehouseId:
              transfer.newLocationWarehouseId ?? employment.locationWarehouseId,
            fte: newFte,
            version: { increment: 1 },
          },
        });
      }

      const result = await tx.employeeTransfer.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_TRANSFER_POSTED',
          entityType: TRANSFER_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
        },
        tx,
      );
      return tx.employeeTransfer.findFirst({ where: { id } });
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
    await this.approvals.approve(tenantId, organizationId, TRANSFER_TYPE, id, userId, comment);
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
    await this.approvals.reject(tenantId, organizationId, TRANSFER_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private async assertNoCycle(
    client: PrismaTransactionClient | PrismaService,
    startManagerEmploymentId: string,
    employmentId: string,
  ) {
    let currentId: string | null = startManagerEmploymentId;
    for (let depth = 0; depth < MAX_HIERARCHY_DEPTH; depth++) {
      if (!currentId) return;
      if (currentId === employmentId)
        throw new ValidationAppError(
          'This manager assignment would create a circular reporting hierarchy',
        );
      const row: { managerEmploymentId: string | null } | null =
        await client.employment.findFirst({
          where: { id: currentId },
          select: { managerEmploymentId: true },
        });
      currentId = row?.managerEmploymentId ?? null;
    }
    throw new ValidationAppError(
      'Manager hierarchy is too deep to validate — possible cycle',
    );
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
