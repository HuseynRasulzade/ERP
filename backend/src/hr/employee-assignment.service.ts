import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface AssignmentInput {
  organizationId: string;
  departmentId: string;
  branchId?: string | null;
  positionId: string;
  staffingPositionId?: string | null;
  managerEmploymentId?: string | null;
  locationId?: string | null;
  fte: Decimal;
  costCenterId?: string | null;
  projectId?: string | null;
  reason?: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
}

/**
 * EmployeeAssignmentService — the authoritative effective-dated history
 * register (spec sections 22-23, 26-28, 50-51). `Employment`'s own
 * department/position/manager/fte columns are kept in sync as a
 * convenience LATEST snapshot only; `getStateAsOf` is the one correct way
 * to answer "what was true on date X" and is what every report in this
 * module reads from, never `Employment`'s own columns directly.
 */
@Injectable()
export class EmployeeAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Opens a new assignment effective `effectiveFrom`, closing whatever
   * assignment was open before it (spec section 26 — "current assignment
   * closed: effective_to = day before new effective date"). Rejects an
   * overlap with any OTHER still-open assignment row (spec section 74) —
   * this build supports exactly one open-ended assignment per employment
   * at a time (disclosed simplification, see docs/HR_CORE.md — the
   * spec's own multi-assignment extension point is not built). */
  async openAssignment(tenantId: string, employmentId: string, effectiveFrom: Date, input: AssignmentInput, tx: PrismaTransactionClient) {
    const current = await tx.employeeAssignment.findFirst({ where: { tenantId, employmentId, effectiveTo: null } });
    if (current) {
      if (current.effectiveFrom >= effectiveFrom) throw new ValidationAppError(`New assignment effective date ${effectiveFrom.toISOString().slice(0, 10)} must be after the current assignment's own effective date ${current.effectiveFrom.toISOString().slice(0, 10)}.`);
      const dayBefore = new Date(effectiveFrom.getTime() - 86_400_000);
      await tx.employeeAssignment.update({ where: { id: current.id }, data: { effectiveTo: dayBefore } });
    }

    if (input.managerEmploymentId) await this.assertNoCircularManagement(tenantId, employmentId, input.managerEmploymentId, tx);

    const row = await tx.employeeAssignment.create({
      data: {
        tenantId,
        employmentId,
        effectiveFrom,
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        branchId: input.branchId,
        positionId: input.positionId,
        staffingPositionId: input.staffingPositionId,
        managerEmploymentId: input.managerEmploymentId,
        locationId: input.locationId,
        fte: input.fte.toString(),
        costCenterId: input.costCenterId,
        projectId: input.projectId,
        reason: input.reason,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
      },
    });

    await tx.employment.update({
      where: { id: employmentId },
      data: {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        branchId: input.branchId,
        positionId: input.positionId,
        staffingPositionId: input.staffingPositionId,
        managerEmploymentId: input.managerEmploymentId,
        locationId: input.locationId,
        fte: input.fte.toString(),
        costCenterId: input.costCenterId,
        projectId: input.projectId,
      },
    });

    return row;
  }

  /** Closes the currently-open assignment without opening a new one
   * (used by Termination). */
  async closeAssignment(tenantId: string, employmentId: string, effectiveTo: Date, tx: PrismaTransactionClient) {
    await tx.employeeAssignment.updateMany({ where: { tenantId, employmentId, effectiveTo: null }, data: { effectiveTo } });
  }

  /** Reopens the assignment history exactly as it stood before a
   * transfer/hire was undone — used only by posting-handler `undoSideEffects`. */
  async reopenPrevious(tenantId: string, employmentId: string, tx: PrismaTransactionClient) {
    const closed = await tx.employeeAssignment.findFirst({ where: { tenantId, employmentId, effectiveTo: { not: null } }, orderBy: { effectiveFrom: 'desc' } });
    if (closed) await tx.employeeAssignment.update({ where: { id: closed.id }, data: { effectiveTo: null } });
  }

  async deleteBySource(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient) {
    await tx.employeeAssignment.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
  }

  /** getEmploymentState(employmentId, asOfDate) — spec section 51's own
   * named function. */
  async getStateAsOf(tenantId: string, employmentId: string, asOfDate: Date) {
    return this.prisma.employeeAssignment.findFirst({
      where: { tenantId, employmentId, effectiveFrom: { lte: asOfDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] },
      orderBy: { effectiveFrom: 'desc' },
      include: { department: true, position: true, branch: true, staffingPosition: true },
    });
  }

  history(tenantId: string, employmentId: string) {
    return this.prisma.employeeAssignment.findMany({ where: { tenantId, employmentId }, orderBy: { effectiveFrom: 'asc' } });
  }

  /** Circular manager hierarchy detection (spec sections 71-72) — walks
   * up the candidate manager's own chain; blocks self-management and any
   * cycle. */
  private async assertNoCircularManagement(tenantId: string, employmentId: string, managerEmploymentId: string, tx: PrismaTransactionClient) {
    if (managerEmploymentId === employmentId) throw new ValidationAppError('An employment cannot be its own manager');
    let current: string | null = managerEmploymentId;
    const seen = new Set<string>();
    while (current) {
      if (current === employmentId) throw new ValidationAppError('This manager assignment would create a circular reporting hierarchy');
      if (seen.has(current)) break; // an existing cycle elsewhere — not this call's problem to fix
      seen.add(current);
      const manager = await tx.employment.findFirst({ where: { id: current, tenantId }, select: { managerEmploymentId: true } });
      current = manager?.managerEmploymentId ?? null;
    }
  }

  /** Org Chart (spec sections 35, 87) — as-of-date, built from the
   * assignment history, never from Employment's own live columns. */
  async orgChartAsOf(tenantId: string, organizationId: string, asOfDate: Date) {
    const assignments = await this.prisma.employeeAssignment.findMany({
      where: { tenantId, organizationId, effectiveFrom: { lte: asOfDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] },
      include: { department: true, position: true, employment: { include: { employee: { include: { physicalPerson: true } } } } },
    });
    return assignments.map((a) => ({
      employmentId: a.employmentId,
      employeeName: a.employment.employee.physicalPerson.fullName,
      department: a.department.name,
      position: a.position.name,
      managerEmploymentId: a.managerEmploymentId,
      fte: a.fte.toString(),
    }));
  }
}
