import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { ApproveExpenseClaimDto } from './dto/expenses.dto';
import { ExpenseTaxService } from './expense-tax.service';
import { ExpenseClassificationService } from './expense-classification.service';
import { EmployeeExpenseSettlementService } from './employee-expense-settlement.service';
import { PaymentSourceTypes } from './expense-codes';

const ENTITY_TYPE = 'EXPENSE_CLAIM';

/**
 * ExpenseApprovalService (docx spec Phase 20 sections 50-53) — partial
 * approval per line, claimed vs approved kept strictly separate
 * (`totalClaimedAmount` set at creation is NEVER overwritten here).
 * Approval is also the point where tax assessment, classification, and
 * employee settlement all run together, atomically, since they all
 * depend on the same final approved figures.
 */
@Injectable()
export class ExpenseApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly tax: ExpenseTaxService,
    private readonly classification: ExpenseClassificationService,
    private readonly settlement: EmployeeExpenseSettlementService,
  ) {}

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ApproveExpenseClaimDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, organizationId }, include: { lines: true } });
    if (!claim) throw new NotFoundAppError('ExpenseClaim', id);
    if (claim.claimStatus !== 'PENDING_APPROVAL' && claim.claimStatus !== 'PARTIALLY_APPROVED')
      throw new ValidationAppError(`Cannot approve an expense claim in status ${claim.claimStatus}`);
    if (claim.version !== dto.expectedVersion) throw new ConcurrencyConflictError();

    const lineIds = new Set(claim.lines.map((l) => l.id));
    for (const approval of dto.lines) {
      if (!lineIds.has(approval.lineId)) throw new ValidationAppError(`Line ${approval.lineId} does not belong to this claim`);
    }
    const approvedByLineId = new Map(dto.lines.map((a) => [a.lineId, a]));

    const result = await this.prisma.runInTransaction(async (tx) => {
      let totalApproved = new Decimal(0);
      let allFullyApproved = true;
      let anyApproved = false;
      for (const line of claim.lines) {
        const approval = approvedByLineId.get(line.id);
        const approvedAmount = approval ? new Decimal(approval.approvedAmount) : new Decimal(0);
        if (approvedAmount.gt(new Decimal(line.baseAmount.toString())))
          throw new ValidationAppError(`Approved amount for line ${line.id} cannot exceed the claimed amount`);
        if (approvedAmount.gt(0)) anyApproved = true;
        if (!approvedAmount.equals(new Decimal(line.baseAmount.toString()))) allFullyApproved = false;
        totalApproved = totalApproved.plus(approvedAmount);
        await tx.expenseClaimLine.update({ where: { id: line.id }, data: { approvedAmount } });
      }

      await this.tax.assessClaim(tenantId, organizationId, id, tx);
      await this.classification.classifyClaim(id, tx);

      const employeeFundedLines = claim.lines.filter((l) =>
        [PaymentSourceTypes.EMPLOYEE_ADVANCE, PaymentSourceTypes.EMPLOYEE_PERSONAL_FUNDS].includes(l.paymentSourceType as any),
      );
      const totalEmployeeFundedApproved = employeeFundedLines.reduce((sum, l) => {
        const approval = approvedByLineId.get(l.id);
        return sum.plus(approval ? new Decimal(approval.approvedAmount) : 0);
      }, new Decimal(0));

      const currencyId = claim.currencyId ?? claim.lines[0]?.transactionCurrencyId ?? null;
      const settlementResult = await this.settlement.settle(tenantId, tx, {
        organizationId,
        employmentId: claim.employmentId,
        responsiblePersonId: claim.responsiblePersonId,
        claimId: id,
        currencyId,
        totalEmployeeFundedApproved,
        effectiveDate: claim.claimDate,
      });

      const claimStatus = !anyApproved ? 'REJECTED' : allFullyApproved ? 'APPROVED' : 'PARTIALLY_APPROVED';
      const updated = await tx.expenseClaim.update({
        where: { id },
        data: {
          totalApprovedAmount: totalApproved,
          advanceAppliedAmount: settlementResult.advanceApplied,
          reimbursementDue: settlementResult.reimbursementDue,
          employeeDebtDue: settlementResult.employeeDebtRemaining,
          claimStatus,
          version: { increment: 1 },
        },
        include: { lines: true },
      });
      return { updated, settlementResult };
    });

    await this.audit.record({
      tenantId,
      eventType: 'EXPENSE_CLAIM_APPROVED',
      entityType: ENTITY_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: {
        totalApprovedAmount: result.updated.totalApprovedAmount.toString(),
        reimbursementDue: result.updated.reimbursementDue.toString(),
        employeeDebtDue: result.updated.employeeDebtDue.toString(),
      },
    });
    return result.updated;
  }
}
