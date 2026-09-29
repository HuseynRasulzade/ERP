import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountablePersonService } from '../cash-desk/accountable-person.service';
import { EXPENSE_MOVEMENT_REGISTER } from './expense-movement-register.service';
import { EMPLOYEE_REIMBURSEMENT_REGISTER } from './employee-expense-settlement.service';

/**
 * ExpenseReportingService (docx spec Phase 20 sections 135-147) — every
 * number here is read from the same subledgers the rest of this module
 * already writes (ExpenseClaim/Line, EXPENSE_MOVEMENT_REGISTER,
 * EMPLOYEE_EXPENSE_REIMBURSEMENT_REGISTER, Phase 15's own
 * AccountablePersonMovement) — never re-derived independently.
 */
@Injectable()
export class ExpenseReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly accountablePersons: AccountablePersonService,
  ) {}

  /** Expense Register (spec section 135) — one row per claim line. */
  async register(tenantId: string, membershipId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const claims = await this.prisma.expenseClaim.findMany({
      where: { tenantId, organizationId, claimDate: { gte: periodStart, lte: periodEnd } },
      include: { lines: { include: { taxAssessment: true } } },
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const claim of claims) {
      for (const line of claim.lines) {
        rows.push({
          claimId: claim.id,
          claimNumber: claim.number,
          employmentId: claim.employmentId,
          expenseDate: line.expenseDate,
          expenseCategoryId: line.expenseCategoryId,
          merchant: line.merchant,
          claimedAmount: line.baseAmount.toString(),
          approvedAmount: line.approvedAmount?.toString() ?? '0.00',
          vatAmount: line.vatAmount.toString(),
          netExpense: new Decimal(line.approvedAmount?.toString() ?? '0').minus(line.vatAmount.toString()).toFixed(2),
          costCenterId: line.costCenterId,
          projectId: line.projectId,
          classification: line.classification,
          claimStatus: claim.claimStatus,
        });
      }
    }
    return rows;
  }

  /** Employee Advances report (spec section 136) — Phase 15's own
   * ageing, never re-derived. */
  async employeeAdvances(tenantId: string, membershipId: string, organizationId: string) {
    return this.accountablePersons.ageing(tenantId, membershipId, organizationId);
  }

  /** Reimbursements report (spec section 137) — the "company owes
   * employee" register. */
  async reimbursements(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const movements = await this.prisma.registerMovement.findMany({
      where: { tenantId, registerCode: EMPLOYEE_REIMBURSEMENT_REGISTER, dimensions: { path: ['organizationId'], equals: organizationId } },
    });
    const byEmployment = new Map<string, Decimal>();
    for (const m of movements) {
      const dims = m.dimensions as { employmentId?: string } | null;
      const resources = m.resources as { amount?: string; direction?: string } | null;
      if (!dims?.employmentId) continue;
      const amount = new Decimal(resources?.amount ?? '0');
      const signed = resources?.direction === 'DECREASE' ? amount.negated() : amount;
      byEmployment.set(dims.employmentId, (byEmployment.get(dims.employmentId) ?? new Decimal(0)).plus(signed));
    }
    return Array.from(byEmployment.entries())
      .filter(([, v]) => v.gt(0.005))
      .map(([employmentId, outstanding]) => ({ employmentId, outstanding: outstanding.toFixed(2) }));
  }

  /** Cost Center P&L input (spec section 138) — direct expense +
   * allocated in - allocated out = net cost, per cost center. */
  async costCenterPnl(tenantId: string, membershipId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const movements = await this.prisma.registerMovement.findMany({
      where: { tenantId, registerCode: EXPENSE_MOVEMENT_REGISTER, businessDate: { gte: periodStart, lte: periodEnd } },
    });
    const byCostCenter = new Map<string, { direct: Decimal; allocatedIn: Decimal; allocatedOut: Decimal }>();
    for (const m of movements) {
      const dims = m.dimensions as { costCenterId?: string | null } | null;
      const costCenterId = dims?.costCenterId;
      if (!costCenterId) continue;
      const bucket = byCostCenter.get(costCenterId) ?? { direct: new Decimal(0), allocatedIn: new Decimal(0), allocatedOut: new Decimal(0) };
      const resources = m.resources as { expenseAmount?: string } | null;
      const amount = new Decimal(resources?.expenseAmount ?? '0');
      if (m.movementType === 'CURRENT_EXPENSE') bucket.direct = bucket.direct.plus(amount);
      else if (m.movementType === 'COST_ALLOCATION_IN') bucket.allocatedIn = bucket.allocatedIn.plus(amount);
      else if (m.movementType === 'COST_ALLOCATION_OUT') bucket.allocatedOut = bucket.allocatedOut.plus(amount.abs());
      byCostCenter.set(costCenterId, bucket);
    }
    return Array.from(byCostCenter.entries()).map(([costCenterId, b]) => ({
      costCenterId,
      directExpense: b.direct.toFixed(2),
      allocatedIn: b.allocatedIn.toFixed(2),
      allocatedOut: b.allocatedOut.toFixed(2),
      netCost: b.direct.plus(b.allocatedIn).minus(b.allocatedOut).toFixed(2),
    }));
  }

  /** Prepaid Expenses report (spec section 141). */
  async prepaidExpenses(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.prepaidExpense.findMany({ where: { organizationId } });
    return rows.map((r) => ({
      id: r.id,
      expenseCategoryId: r.expenseCategoryId,
      originalAmount: r.originalAmount.toString(),
      recognizedAmount: r.recognizedAmount.toString(),
      remainingAmount: r.remainingAmount.toString(),
      recognitionEndDate: r.recognitionEndDate,
      status: r.status,
    }));
  }
}
