import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountablePersonService } from '../cash-desk/accountable-person.service';

export const EMPLOYEE_REIMBURSEMENT_REGISTER = 'EMPLOYEE_EXPENSE_REIMBURSEMENT_REGISTER';
const REIMBURSEMENT_ALLOCATION_TYPE = 'EMPLOYEE_REIMBURSEMENT_PAYMENT';

export interface SettlementResult {
  totalEmployeeFunded: Decimal;
  advanceOutstandingBefore: Decimal;
  advanceApplied: Decimal;
  reimbursementDue: Decimal;
  employeeDebtRemaining: Decimal;
}

/**
 * EmployeeExpenseSettlementService (docx spec Phase 20 sections 21-28,
 * 92-96) — Phase 15's `AccountablePersonMovement` is reused, unchanged,
 * as the source of truth for the "employee owes company" (advance)
 * direction; this module never duplicates that ledger. The opposite
 * direction — "company owes employee" — is a NEW register
 * (`EMPLOYEE_EXPENSE_REIMBURSEMENT_REGISTER`, reusing the generic
 * RegisterMovement ledger) since Phase 15 has no concept of the company
 * owing the accountable person money.
 *
 * Disclosed simplification: `AccountablePersonMovement.personId` has a
 * real foreign key to Phase 0's `ResponsiblePerson` (tied to a User),
 * not Phase 17's `Employment` — the two identities are never reconciled
 * in this codebase. `ExpenseClaim.responsiblePersonId` is the caller-
 * supplied bridge (whoever issued the Phase 15 advance already knows
 * which ResponsiblePerson holds it); a claim with no such link simply
 * has nothing to consume, so its whole employee-funded amount becomes a
 * reimbursement due instead of blocking. See docs/EXPENSES.md.
 */
@Injectable()
export class EmployeeExpenseSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountablePersons: AccountablePersonService,
  ) {}

  /** Settles one APPROVED claim against the employee's Phase-15 advance
   * balance (spec sections 22-25): the approved total funded by the
   * employee (advance or personal funds) first consumes any outstanding
   * advance; anything beyond that becomes a reimbursement the company
   * owes; anything short leaves the remainder of the advance as the
   * employee's own outstanding debt (already visible via Phase 15's own
   * `AccountablePersonService.getBalance`, never duplicated here). */
  async settle(
    tenantId: string,
    tx: PrismaTransactionClient,
    params: {
      organizationId: string;
      employmentId: string;
      responsiblePersonId: string | null;
      claimId: string;
      currencyId: string | null;
      totalEmployeeFundedApproved: Decimal;
      effectiveDate: Date;
    },
  ): Promise<SettlementResult> {
    // No linked ResponsiblePerson means there is no Phase 15 advance to
    // settle against at all — the entire employee-funded amount is a
    // reimbursement due (spec section 24: "Employee receives no advance").
    const outstandingNonNegative = params.responsiblePersonId
      ? Decimal.max(
          0,
          (
            await tx.accountablePersonMovement.findMany({
              where: { tenantId, personId: params.responsiblePersonId, currencyId: params.currencyId },
            })
          ).reduce((sum, m) => {
            const amount = new Decimal(m.amount.toString());
            if (m.movementType === 'ADVANCE_ISSUED' || m.movementType === 'ADDITIONAL_REIMBURSEMENT') return sum.plus(amount);
            if (m.movementType === 'RETURNED' || m.movementType === 'EXPENSE_REPORTED') return sum.minus(amount.abs());
            return sum;
          }, new Decimal(0)),
        )
      : new Decimal(0);
    const advanceOutstandingBefore = outstandingNonNegative;

    const advanceApplied = Decimal.min(params.totalEmployeeFundedApproved, outstandingNonNegative);
    const reimbursementDue = Decimal.max(0, params.totalEmployeeFundedApproved.minus(outstandingNonNegative));
    const employeeDebtRemaining = Decimal.max(0, outstandingNonNegative.minus(params.totalEmployeeFundedApproved));

    if (advanceApplied.gt(0) && params.responsiblePersonId) {
      await this.accountablePersons.recordMovement(
        tenantId,
        {
          organizationId: params.organizationId,
          personId: params.responsiblePersonId,
          currencyId: params.currencyId,
          movementType: 'EXPENSE_REPORTED',
          amount: advanceApplied,
          sourceDocumentType: 'EXPENSE_CLAIM',
          sourceDocumentId: params.claimId,
          effectiveDate: params.effectiveDate,
        },
        tx,
      );
    }

    if (reimbursementDue.gt(0)) {
      await this.writeReimbursementMovement(tenantId, tx, {
        recorderDocumentId: params.claimId,
        employmentId: params.employmentId,
        organizationId: params.organizationId,
        amount: reimbursementDue,
        direction: 'INCREASE',
        businessDate: params.effectiveDate,
      });
    }

    return { totalEmployeeFunded: params.totalEmployeeFundedApproved, advanceOutstandingBefore, advanceApplied, reimbursementDue, employeeDebtRemaining };
  }

  async getReimbursementOutstanding(tenantId: string, employmentId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const client = tx ?? this.prisma;
    const movements = await client.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: EMPLOYEE_REIMBURSEMENT_REGISTER,
        dimensions: { path: ['employmentId'], equals: employmentId },
      },
    });
    return movements.reduce((sum, m) => {
      const resources = m.resources as { amount?: string; direction?: string } | null;
      const amount = new Decimal(resources?.amount ?? '0');
      return resources?.direction === 'DECREASE' ? sum.minus(amount) : sum.plus(amount);
    }, new Decimal(0));
  }

  /** Records a reimbursement PAYMENT (DECREASE) — the stable interface
   * Phase 14 (bank)/Phase 15 (cash) are expected to call once built. */
  async recordReimbursementPayment(
    tenantId: string,
    tx: PrismaTransactionClient,
    params: { allocationId: string; employmentId: string; organizationId: string; amount: Decimal; businessDate: Date },
  ) {
    await this.writeReimbursementMovement(tenantId, tx, {
      recorderDocumentId: params.allocationId,
      employmentId: params.employmentId,
      organizationId: params.organizationId,
      amount: params.amount,
      direction: 'DECREASE',
      businessDate: params.businessDate,
    });
  }

  private async writeReimbursementMovement(
    tenantId: string,
    tx: PrismaTransactionClient,
    params: { recorderDocumentId: string; employmentId: string; organizationId: string; amount: Decimal; direction: 'INCREASE' | 'DECREASE'; businessDate: Date },
  ) {
    const sequence = await tx.registerMovement.count({
      where: { tenantId, registerCode: EMPLOYEE_REIMBURSEMENT_REGISTER, recorderDocumentType: REIMBURSEMENT_ALLOCATION_TYPE, recorderDocumentId: params.recorderDocumentId },
    });
    await tx.registerMovement.create({
      data: {
        tenantId,
        registerCode: EMPLOYEE_REIMBURSEMENT_REGISTER,
        recorderDocumentType: REIMBURSEMENT_ALLOCATION_TYPE,
        recorderDocumentId: params.recorderDocumentId,
        businessDate: params.businessDate,
        sequence: BigInt(sequence + 1),
        movementType: 'REIMBURSEMENT_DUE',
        dimensions: { employmentId: params.employmentId, organizationId: params.organizationId },
        resources: { amount: params.amount.toString(), direction: params.direction },
      },
    });
  }
}
