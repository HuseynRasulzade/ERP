import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { EmployeeAssignmentService } from './employee-assignment.service';
import { HR_TERMINATION_TYPE } from './termination.repository';

/**
 * Posting handler for TerminationDocument (spec sections 43-46). Closes
 * the open assignment/schedule/status-history rows and flips the
 * employment to TERMINATED — never deletes the employee or physical
 * person (spec section 46's own "PhysicalPerson qalır. Employee qalır.").
 */
@Injectable()
export class TerminationPostingHandler implements DocumentPostingHandler {
  readonly documentType = HR_TERMINATION_TYPE;

  constructor(private readonly assignments: EmployeeAssignmentService) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const termination = await tx.terminationDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!termination) throw new ValidationAppError('Document disappeared during posting');
    const employment = await tx.employment.findFirst({ where: { id: termination.employmentId, tenantId } });
    if (!employment) throw new ValidationAppError('Linked employment not found');
    if (!['ACTIVE', 'PLANNED', 'SUSPENDED', 'ON_LEAVE'].includes(employment.employmentStatus)) throw new ValidationAppError(`Cannot terminate a ${employment.employmentStatus} employment`);
    if (termination.terminationDate < employment.employmentStartDate) throw new ValidationAppError('Termination date cannot be before the hire date (spec section 75)');

    const dependentManagers = await tx.employment.count({ where: { tenantId, managerEmploymentId: employment.id, employmentStatus: { in: ['ACTIVE', 'PLANNED'] } } });
    if (dependentManagers > 0) throw new ValidationAppError(`Cannot terminate — ${dependentManagers} employee(s) still report to this employment. Reassign their manager first.`);
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const termination = await tx.terminationDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!termination) throw new ValidationAppError('Document disappeared during posting');
    const employment = await tx.employment.findFirstOrThrow({ where: { id: termination.employmentId } });

    await this.assignments.closeAssignment(tenantId, employment.id, termination.terminationDate, tx);
    await tx.workScheduleAssignment.updateMany({ where: { tenantId, employmentId: employment.id, effectiveTo: null }, data: { effectiveTo: termination.terminationDate } });
    await tx.employmentStatusHistory.updateMany({ where: { tenantId, employmentId: employment.id, effectiveTo: null }, data: { effectiveTo: new Date(termination.terminationDate.getTime() - 86_400_000) } });
    await tx.employmentStatusHistory.create({ data: { tenantId, employmentId: employment.id, status: 'TERMINATED', effectiveFrom: termination.terminationDate, reason: termination.terminationReason, sourceDocumentType: HR_TERMINATION_TYPE, sourceDocumentId: termination.id } });
    await tx.employment.update({ where: { id: employment.id }, data: { employmentStatus: 'TERMINATED', employmentEndDate: termination.terminationDate } });
    await tx.employee.update({ where: { id: employment.employeeId }, data: { lastTerminationDate: termination.terminationDate } });

    return null; // no GL consequence — see class doc
  }

  /** Blocked once a payroll final settlement dependency exists (spec
   * section 49) — this build has no payroll module yet, so the only
   * dependency actually checked is a rehire already linked back to this
   * termination. */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const termination = await tx.terminationDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!termination) return;
    const rehire = await tx.employment.findFirst({ where: { tenantId, previousEmploymentId: termination.employmentId } });
    if (rehire) throw new ValidationAppError('Cannot reverse this termination — a rehire already references it.');

    await this.assignments.reopenPrevious(tenantId, termination.employmentId, tx);
    await tx.workScheduleAssignment.updateMany({ where: { tenantId, employmentId: termination.employmentId, effectiveTo: termination.terminationDate }, data: { effectiveTo: null } });
    await tx.employmentStatusHistory.deleteMany({ where: { tenantId, employmentId: termination.employmentId, sourceDocumentType: HR_TERMINATION_TYPE, sourceDocumentId: termination.id } });
    const lastClosed = await tx.employmentStatusHistory.findFirst({ where: { tenantId, employmentId: termination.employmentId, effectiveTo: { not: null } }, orderBy: { effectiveFrom: 'desc' } });
    if (lastClosed) await tx.employmentStatusHistory.update({ where: { id: lastClosed.id }, data: { effectiveTo: null } });
    await tx.employment.update({ where: { id: termination.employmentId }, data: { employmentStatus: 'ACTIVE', employmentEndDate: null } });
  }
}
