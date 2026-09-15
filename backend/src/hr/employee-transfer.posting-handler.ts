import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { EmployeeAssignmentService } from './employee-assignment.service';
import { StaffingService } from './staffing.service';
import { HR_TRANSFER_TYPE } from './employee-transfer.repository';

/**
 * Posting handler for EmployeeTransfer (spec sections 24-28). Opens a new
 * `EmployeeAssignment` effective `effectiveDate`, closing the currently
 * open one the day before (spec section 26) — future-dated transfers
 * (spec section 28) are fully supported since `openAssignment` only
 * requires the new date be after the current assignment's own start, not
 * "today". Every `new*` field is optional — an unset one simply carries
 * the CURRENT assignment's value forward (a `POSITION_CHANGE` transfer
 * need not restate the department, for example).
 */
@Injectable()
export class EmployeeTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = HR_TRANSFER_TYPE;

  constructor(
    private readonly assignments: EmployeeAssignmentService,
    private readonly staffing: StaffingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.employeeTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const employment = await tx.employment.findFirst({ where: { id: transfer.employmentId, tenantId } });
    if (!employment) throw new ValidationAppError('Linked employment not found');
    if (!['ACTIVE', 'PLANNED', 'SUSPENDED', 'ON_LEAVE'].includes(employment.employmentStatus)) throw new ValidationAppError(`Cannot transfer a ${employment.employmentStatus} employment`);

    if (transfer.newDepartmentId) {
      const dept = await tx.department.findFirst({ where: { id: transfer.newDepartmentId, tenantId } });
      if (!dept || !dept.active) throw new ValidationAppError('Cannot transfer into an inactive department');
    }
    if (transfer.newPositionId) {
      const position = await tx.position.findFirst({ where: { id: transfer.newPositionId, tenantId } });
      if (!position || !position.active) throw new ValidationAppError('Cannot transfer into an inactive position');
    }
    if (transfer.newFte && new Decimal(transfer.newFte.toString()).lte(0)) throw new ValidationAppError('FTE must be positive');
    if (transfer.newStaffingPositionId) {
      const fte = transfer.newFte ? new Decimal(transfer.newFte.toString()) : new Decimal(employment.fte.toString());
      await this.staffing.checkOverstaff(tenantId, transfer.newStaffingPositionId, fte);
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const transfer = await tx.employeeTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const employment = await tx.employment.findFirstOrThrow({ where: { id: transfer.employmentId } });

    await this.assignments.openAssignment(
      tenantId,
      employment.id,
      transfer.effectiveDate,
      {
        organizationId: transfer.newOrganizationId ?? employment.organizationId,
        departmentId: transfer.newDepartmentId ?? employment.departmentId,
        branchId: transfer.newBranchId ?? employment.branchId,
        positionId: transfer.newPositionId ?? employment.positionId,
        staffingPositionId: transfer.newStaffingPositionId ?? employment.staffingPositionId,
        managerEmploymentId: transfer.newManagerEmploymentId ?? employment.managerEmploymentId,
        locationId: transfer.newLocationId ?? employment.locationId,
        fte: transfer.newFte ? new Decimal(transfer.newFte.toString()) : new Decimal(employment.fte.toString()),
        costCenterId: employment.costCenterId,
        projectId: employment.projectId,
        reason: transfer.reason ?? transfer.transferType,
        sourceDocumentType: HR_TRANSFER_TYPE,
        sourceDocumentId: transfer.id,
      },
      tx,
    );

    if (transfer.newWorkScheduleId) {
      await tx.workScheduleAssignment.updateMany({ where: { tenantId, employmentId: employment.id, effectiveTo: null }, data: { effectiveTo: new Date(transfer.effectiveDate.getTime() - 86_400_000) } });
      await tx.workScheduleAssignment.create({ data: { tenantId, employmentId: employment.id, workScheduleId: transfer.newWorkScheduleId, effectiveFrom: transfer.effectiveDate, sourceDocumentType: HR_TRANSFER_TYPE, sourceDocumentId: transfer.id, reason: 'SCHEDULE_CHANGE' } });
    }

    return null; // no GL consequence — see class doc
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.employeeTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) return;
    const laterTransfer = await tx.employeeAssignment.findFirst({ where: { tenantId, employmentId: transfer.employmentId, effectiveFrom: { gt: transfer.effectiveDate } } });
    if (laterTransfer) throw new ValidationAppError('Cannot unpost — a later transfer already exists for this employment. Reverse that first.');

    await this.assignments.deleteBySource(tenantId, HR_TRANSFER_TYPE, document.id, tx);
    await this.assignments.reopenPrevious(tenantId, transfer.employmentId, tx);
    if (transfer.newWorkScheduleId) {
      await tx.workScheduleAssignment.deleteMany({ where: { tenantId, sourceDocumentType: HR_TRANSFER_TYPE, sourceDocumentId: document.id } });
      await tx.workScheduleAssignment.updateMany({ where: { tenantId, employmentId: transfer.employmentId, effectiveTo: { not: null } }, data: { effectiveTo: null }, });
    }
  }
}
