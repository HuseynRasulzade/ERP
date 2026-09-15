import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AccountablePersonService } from '../cash/accountable-person.service';
import { EXPENSE_CLAIM_TYPE } from './expense-claim.repository';

const SEQUENCE_PREFIX = 'EXP';

export interface ExpenseClaimLineInput {
  expenseDate: string;
  expenseCategoryId: string;
  merchant?: string;
  supplierTaxId?: string;
  description?: string;
  businessPurpose?: string;
  transactionCurrencyId: string;
  transactionAmount: number;
  exchangeRate?: number;
  baseAmount: number;
  taxAmount?: number;
  recoverableVat?: number;
  nonrecoverableVat?: number;
  paymentSourceType: string;
  costCenterId?: string;
  projectId?: string;
  departmentId?: string;
  classification?: string;
  prepaidCandidate?: boolean;
  capitalizableCandidate?: boolean;
  receiptAttached?: boolean;
}

/**
 * ExpenseClaimService (spec sections 11-19). Applies each line's own
 * `ExpenseCategory` policy at CREATE time (spec section 17 — "Silent
 * approval etmə"): a missing required receipt or missing business
 * purpose sets `policyStatus` rather than silently accepting the line;
 * posting later refuses any line still in that state (see
 * `ExpenseClaimPostingHandler`) unless a manager records an exception
 * via `approveLine`.
 */
@Injectable()
export class ExpenseClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly accountablePersons: AccountablePersonService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { employeeId: string; employmentId: string; documentDate: string; expensePeriodStart: string; expensePeriodEnd: string; currencyId: string; responsibleManagerId?: string; comment?: string; lines: ExpenseClaimLineInput[] },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.lines.length === 0) throw new ValidationAppError('An expense claim requires at least one line');
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, EXPENSE_CLAIM_TYPE, documentDate, tx);
      const claim = await tx.expenseClaim.create({
        data: {
          tenantId,
          organizationId,
          employeeId: dto.employeeId,
          employmentId: dto.employmentId,
          documentDate,
          expensePeriodStart: new Date(dto.expensePeriodStart),
          expensePeriodEnd: new Date(dto.expensePeriodEnd),
          currencyId: dto.currencyId,
          responsibleManagerId: dto.responsibleManagerId,
          comment: dto.comment,
          number: allocated.formatted,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      let totalClaimed = new Decimal(0);
      for (const line of dto.lines) {
        const category = await tx.expenseCategory.findFirstOrThrow({ where: { id: line.expenseCategoryId, organizationId } });
        const baseAmount = new Decimal(line.baseAmount);
        totalClaimed = totalClaimed.plus(baseAmount);

        let policyStatus = 'OK';
        if (category.businessPurposeRequired && !line.businessPurpose) policyStatus = 'MISSING_BUSINESS_PURPOSE';
        else if (!line.receiptAttached) {
          const required = category.receiptRequirement === 'REQUIRED' || (category.receiptRequirement === 'REQUIRED_ABOVE_THRESHOLD' && category.receiptThreshold != null && baseAmount.gt(category.receiptThreshold.toString()));
          if (required) policyStatus = 'MISSING_RECEIPT';
        }
        if (policyStatus === 'OK' && category.perTransactionLimit != null && baseAmount.gt(category.perTransactionLimit.toString())) policyStatus = 'EXCEEDS_LIMIT';

        await tx.expenseClaimLine.create({
          data: {
            tenantId,
            claimId: claim.id,
            expenseDate: new Date(line.expenseDate),
            expenseCategoryId: line.expenseCategoryId,
            merchant: line.merchant,
            supplierTaxId: line.supplierTaxId,
            description: line.description,
            businessPurpose: line.businessPurpose,
            transactionCurrencyId: line.transactionCurrencyId,
            transactionAmount: line.transactionAmount.toString(),
            exchangeRate: line.exchangeRate?.toString(),
            baseAmount: baseAmount.toString(),
            taxAmount: (line.taxAmount ?? 0).toString(),
            recoverableVat: (line.recoverableVat ?? 0).toString(),
            nonrecoverableVat: (line.nonrecoverableVat ?? 0).toString(),
            paymentSourceType: line.paymentSourceType,
            costCenterId: line.costCenterId,
            projectId: line.projectId,
            departmentId: line.departmentId,
            classification: line.classification ?? 'CURRENT_EXPENSE',
            prepaidCandidate: line.prepaidCandidate ?? false,
            capitalizableCandidate: line.capitalizableCandidate ?? false,
            policyStatus,
          },
        });
      }

      await tx.expenseClaim.update({ where: { id: claim.id }, data: { totalClaimedAmount: totalClaimed.toString() } });
      await this.audit.record({ tenantId, eventType: 'EXPENSE_CLAIM_CREATED', entityType: EXPENSE_CLAIM_TYPE, entityId: claim.id, action: 'CREATE', userId, newValues: { totalClaimed: totalClaimed.toString(), lineCount: dto.lines.length } }, tx);
      return tx.expenseClaim.findUniqueOrThrow({ where: { id: claim.id }, include: { lines: true } });
    });
  }

  /** Records a manager's exception approval for a line stuck at
   * `MISSING_RECEIPT`/`MISSING_BUSINESS_PURPOSE` (spec section 17). */
  async approveLineException(tenantId: string, userId: string, lineId: string, comment: string) {
    const line = await this.prisma.expenseClaimLine.findFirst({ where: { id: lineId, tenantId } });
    if (!line) throw new NotFoundAppError('ExpenseClaimLine', lineId);
    const row = await this.prisma.expenseClaimLine.update({ where: { id: lineId }, data: { policyStatus: 'EXCEPTION_APPROVED' } });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_CLAIM_LINE_EXCEPTION_APPROVED', entityType: 'EXPENSE_CLAIM_LINE', entityId: lineId, action: 'UPDATE', userId, newValues: { comment } });
    return row;
  }

  /** Partial approval — claimed amount is NEVER overwritten (spec
   * section 53); `approvedAmount` is a separate field. */
  async approveLine(tenantId: string, userId: string, lineId: string, approvedAmount: number, rejectionReason?: string) {
    const line = await this.prisma.expenseClaimLine.findFirst({ where: { id: lineId, tenantId } });
    if (!line) throw new NotFoundAppError('ExpenseClaimLine', lineId);
    if (approvedAmount > Number(line.baseAmount.toString()) + 0.01) throw new ValidationAppError('Approved amount cannot exceed the claimed base amount');
    const row = await this.prisma.expenseClaimLine.update({ where: { id: lineId }, data: { approvedAmount: approvedAmount.toString(), rejectionReason: approvedAmount < Number(line.baseAmount.toString()) ? rejectionReason : null } });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_CLAIM_LINE_APPROVED', entityType: 'EXPENSE_CLAIM_LINE', entityId: lineId, action: 'UPDATE', userId, newValues: { approvedAmount } });
    return row;
  }

  async finalizeApproval(tenantId: string, membershipId: string, organizationId: string, userId: string, claimId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const claim = await this.prisma.expenseClaim.findFirst({ where: { id: claimId, tenantId, organizationId }, include: { lines: true } });
    if (!claim) throw new NotFoundAppError('ExpenseClaim', claimId);
    const unapproved = claim.lines.filter((l) => l.approvedAmount == null);
    if (unapproved.length > 0) throw new ValidationAppError(`${unapproved.length} line(s) have not been decisioned yet (approve or reject each line first)`);

    const totalApproved = claim.lines.reduce((s, l) => s.plus(l.approvedAmount!.toString()), new Decimal(0));
    const allApproved = claim.lines.every((l) => new Decimal(l.approvedAmount!.toString()).gte(l.baseAmount.toString()));
    const anyApproved = claim.lines.some((l) => new Decimal(l.approvedAmount!.toString()).gt(0));
    const approvalStatus = !anyApproved ? 'REJECTED' : allApproved ? 'APPROVED' : 'PARTIALLY_APPROVED';

    const advanceOutstanding = await this.accountablePersons.getOutstanding(tenantId, claim.organizationId, claim.employeeId, claim.currencyId);
    const reimbursementDue = Decimal.max(totalApproved.minus(advanceOutstanding), 0);
    const employeeDebtDue = Decimal.max(advanceOutstanding.minus(totalApproved), 0);

    const row = await this.prisma.expenseClaim.update({ where: { id: claimId }, data: { totalApprovedAmount: totalApproved.toString(), advanceAmount: advanceOutstanding.toString(), reimbursementDue: reimbursementDue.toString(), employeeDebtDue: employeeDebtDue.toString(), approvalStatus } });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_CLAIM_APPROVAL_FINALIZED', entityType: EXPENSE_CLAIM_TYPE, entityId: claimId, action: 'UPDATE', userId, newValues: { approvalStatus, totalApproved: totalApproved.toString() } });
    return row;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.expenseClaim.findFirst({ where: { id, organizationId }, include: { lines: { include: { category: true, receipts: true } } } });
    if (!row) throw new NotFoundAppError('ExpenseClaim', id);
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string, employeeId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.expenseClaim.findMany({ where: { organizationId, employeeId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: EXPENSE_CLAIM_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: EXPENSE_CLAIM_TYPE, documentType: EXPENSE_CLAIM_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
