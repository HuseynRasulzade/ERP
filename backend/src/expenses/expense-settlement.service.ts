import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * ExpenseSettlementService (spec sections 26-27). Computed live, entirely
 * from Phase 15's own `AccountablePersonMovement` register and Phase 13/
 * 14/15's own `SettlementPayment` — never a duplicate ledger. This is
 * exactly the "do not store only claim.is_paid" register the spec asks
 * for (spec section 27), assembled from existing subledgers rather than
 * a new `EmployeeExpenseSettlementRegister` table.
 */
@Injectable()
export class ExpenseSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async register(tenantId: string, membershipId: string, organizationId: string, employeeId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const movements = await this.prisma.accountablePersonMovement.findMany({ where: { tenantId, organizationId, employeeId }, orderBy: { effectiveDate: 'asc' } });
    const advanceIssued = movements.filter((m) => m.movementType === 'ISSUE').reduce((s, m) => s.plus(m.amount.toString()), new Decimal(0));
    const expenseApproved = movements.filter((m) => m.movementType === 'EXPENSE_REPORTED').reduce((s, m) => s.plus(new Decimal(m.amount.toString()).abs()), new Decimal(0));
    const returned = movements.filter((m) => m.movementType === 'RETURN').reduce((s, m) => s.plus(new Decimal(m.amount.toString()).abs()), new Decimal(0));
    const outstandingAdvance = movements.reduce((s, m) => s.plus(m.amount.toString()), new Decimal(0));

    const claims = await this.prisma.expenseClaim.findMany({ where: { tenantId, organizationId, employeeId, postingStatus: 'POSTED' } });
    const companyPayable = claims.reduce((s, c) => s.plus(c.reimbursementDue.toString()), new Decimal(0));

    const reimbursementPayments = await this.prisma.settlementPayment.findMany({ where: { tenantId, organizationId, employeeId, postingStatus: 'POSTED', operationType: { in: ['EMPLOYEE_ADVANCE_RETURN'] } } });
    const reimbursed = reimbursementPayments.reduce((s, p) => s.plus(p.amount.toString()), new Decimal(0));

    return {
      employeeId,
      advanceIssued: advanceIssued.toString(),
      expenseApproved: expenseApproved.toString(),
      returned: returned.toString(),
      reimbursementPaid: reimbursed.toString(),
      outstandingEmployeeDebt: outstandingAdvance.gt(0) ? outstandingAdvance.toString() : '0',
      outstandingCompanyPayable: Decimal.max(companyPayable.minus(reimbursed), 0).toString(),
      movements,
    };
  }
}
