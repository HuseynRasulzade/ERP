import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { EmployeeAssignmentService } from './employee-assignment.service';
import { StaffingService } from './staffing.service';
import { HR_HIRE_TYPE } from './hire.repository';

/**
 * Posting handler for HireDocument (spec sections 20-21). HR "posting" is
 * never an accounting posting (spec section 65) — `buildAccountingBatch`
 * always returns null; POST here means "commit the effective HR register"
 * only: validate -> activate Employment -> open the initial
 * EmployeeAssignment -> open a WorkScheduleAssignment if given -> write
 * EmploymentStatusHistory. A future-dated hire (spec section 21) still
 * posts immediately — the Employment's `employmentStatus` is computed
 * once, at post time, as `ACTIVE` if `hireDate <= today` else `PLANNED`;
 * no scheduled job later flips PLANNED to ACTIVE automatically in this
 * build (disclosed simplification, see docs/HR_CORE.md) — a manual
 * "activate" call or the next HR event covers it.
 */
@Injectable()
export class HirePostingHandler implements DocumentPostingHandler {
  readonly documentType = HR_HIRE_TYPE;

  constructor(
    private readonly assignments: EmployeeAssignmentService,
    private readonly staffing: StaffingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const hire = await tx.hireDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!hire) throw new ValidationAppError('Document disappeared during posting');
    const employment = await tx.employment.findFirst({ where: { id: hire.employmentId, tenantId } });
    if (!employment) throw new ValidationAppError('Linked employment not found');
    if (employment.employmentStatus !== 'PLANNED') throw new ValidationAppError(`Employment is already ${employment.employmentStatus} — a hire can only post once`);
    if (new Decimal(employment.fte.toString()).lte(0)) throw new ValidationAppError('FTE must be positive');

    const department = await tx.department.findFirst({ where: { id: employment.departmentId, tenantId } });
    if (!department || !department.active) throw new ValidationAppError('Cannot hire into an inactive department');
    const position = await tx.position.findFirst({ where: { id: employment.positionId, tenantId } });
    if (!position || !position.active) throw new ValidationAppError('Cannot hire into an inactive position');

    if (employment.primaryEmployment) {
      const otherPrimary = await tx.employment.findFirst({ where: { tenantId, employeeId: employment.employeeId, primaryEmployment: true, employmentStatus: { in: ['ACTIVE', 'PLANNED', 'SUSPENDED', 'ON_LEAVE'] }, id: { not: employment.id } } });
      if (otherPrimary) throw new ValidationAppError('This employee already has another active/planned primary employment (spec section 30 — at most one primary employment at a time).');
    }

    if (employment.managerEmploymentId) {
      const manager = await tx.employment.findFirst({ where: { id: employment.managerEmploymentId, tenantId } });
      if (!manager || !['ACTIVE', 'PLANNED'].includes(manager.employmentStatus)) throw new ValidationAppError('Manager employment is not active');
    }

    if (employment.staffingPositionId) {
      await this.staffing.checkOverstaff(tenantId, employment.staffingPositionId, new Decimal(employment.fte.toString()));
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  /** HR "posting" never produces a GL consequence (spec section 65) —
   * this method still runs (and always returns null) because it's where
   * every OTHER posting handler in this codebase performs its own
   * document-specific side effects inside the posting transaction (see
   * e.g. `CashDeskTransferPostingHandler`), not because it books
   * anything. */
  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const hire = await tx.hireDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!hire) throw new ValidationAppError('Document disappeared during posting');
    const employment = await tx.employment.findFirstOrThrow({ where: { id: hire.employmentId } });
    const newStatus = hire.hireDate <= new Date() ? 'ACTIVE' : 'PLANNED';

    await tx.employment.update({ where: { id: employment.id }, data: { employmentStatus: newStatus } });
    await this.assignments.openAssignment(
      tenantId,
      employment.id,
      hire.hireDate,
      { organizationId: employment.organizationId, departmentId: employment.departmentId, branchId: employment.branchId, positionId: employment.positionId, staffingPositionId: employment.staffingPositionId, managerEmploymentId: employment.managerEmploymentId, locationId: employment.locationId, fte: new Decimal(employment.fte.toString()), costCenterId: employment.costCenterId, projectId: employment.projectId, reason: 'HIRE', sourceDocumentType: HR_HIRE_TYPE, sourceDocumentId: hire.id },
      tx,
    );
    if (employment.workScheduleId) {
      await tx.workScheduleAssignment.create({ data: { tenantId, employmentId: employment.id, workScheduleId: employment.workScheduleId, effectiveFrom: hire.hireDate, sourceDocumentType: HR_HIRE_TYPE, sourceDocumentId: hire.id, reason: 'HIRE' } });
    }
    await tx.employmentStatusHistory.create({ data: { tenantId, employmentId: employment.id, status: newStatus, effectiveFrom: hire.hireDate, sourceDocumentType: HR_HIRE_TYPE, sourceDocumentId: hire.id } });
    const employee = await tx.employee.findUnique({ where: { id: hire.employeeId } });
    if (employee && !employee.hireFirstDate) await tx.employee.update({ where: { id: hire.employeeId }, data: { hireFirstDate: hire.hireDate } });

    return null; // no GL consequence — see class doc
  }

  /** Blocked once the employment has progressed past what a hire alone
   * established (any later assignment/transfer/termination already
   * exists) — same "reverse dependency chain" discipline as every other
   * posting handler in this codebase. */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const hire = await tx.hireDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!hire) return;
    const laterAssignments = await tx.employeeAssignment.count({ where: { tenantId, employmentId: hire.employmentId, sourceDocumentType: { not: HR_HIRE_TYPE } } });
    if (laterAssignments > 0) throw new ValidationAppError('Cannot unpost this hire — the employment has later transfers/changes. Reverse those first.');

    await this.assignments.deleteBySource(tenantId, HR_HIRE_TYPE, document.id, tx);
    await tx.workScheduleAssignment.deleteMany({ where: { tenantId, sourceDocumentType: HR_HIRE_TYPE, sourceDocumentId: document.id } });
    await tx.employmentStatusHistory.deleteMany({ where: { tenantId, sourceDocumentType: HR_HIRE_TYPE, sourceDocumentId: document.id } });
    await tx.employment.update({ where: { id: hire.employmentId }, data: { employmentStatus: 'PLANNED' } });
  }
}
