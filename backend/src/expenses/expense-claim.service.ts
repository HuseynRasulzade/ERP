import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateExpenseClaimDto, SubmitExpenseClaimDto } from './dto/expenses.dto';
import { ExpenseValidationService } from './expense-validation.service';

export const EXPENSE_CLAIM_TYPE = 'EXPENSE_CLAIM';
const SEQUENCE_PREFIX = 'EC';
const ENTITY_TYPE = EXPENSE_CLAIM_TYPE;

/**
 * ExpenseClaimService (docx spec Phase 20 sections 11-13, 19). Claimed vs
 * policy-allowed vs approved vs posted vs settled amounts are always kept
 * distinct (spec section 53) — `create()` only ever populates the
 * claimed side; `totalApprovedAmount` is written exclusively by
 * ExpenseApprovalService.
 */
@Injectable()
export class ExpenseClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly validation: ExpenseValidationService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.expenseClaim.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { lines: { include: { receipts: true } } },
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.expenseClaim.findFirst({
      where: { id, organizationId },
      include: { lines: { include: { receipts: true, taxAssessment: true } } },
    });
    if (!row) throw new NotFoundAppError('ExpenseClaim', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateExpenseClaimDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.lines.length === 0) throw new ValidationAppError('An expense claim must have at least one line');
    const claimDate = new Date(dto.claimDate);

    const categoryIds = Array.from(new Set(dto.lines.map((l) => l.expenseCategoryId)));
    const categories = await this.prisma.expenseCategory.findMany({ where: { tenantId, id: { in: categoryIds } } });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    let totalClaimed = new Decimal(0);
    const lineData = dto.lines.map((line) => {
      const category = categoryById.get(line.expenseCategoryId);
      if (!category) throw new ValidationAppError(`Unknown expenseCategoryId ${line.expenseCategoryId}`);
      if (category.businessPurposeRequired && !line.businessPurpose)
        throw new ValidationAppError(
          `Category ${category.name} requires a business purpose — a bare description is not sufficient`,
        );
      const exchangeRate = new Decimal(line.exchangeRate ?? 1);
      const baseAmount = new Decimal(line.transactionAmount).mul(exchangeRate).toDecimalPlaces(2);
      totalClaimed = totalClaimed.plus(baseAmount);
      return {
        tenantId,
        expenseDate: new Date(line.expenseDate),
        expenseCategoryId: line.expenseCategoryId,
        merchant: line.merchant,
        supplierId: line.supplierId,
        supplierTaxId: line.supplierTaxId,
        description: line.description,
        businessPurpose: line.businessPurpose,
        transactionCurrencyId: line.transactionCurrencyId,
        transactionAmount: new Decimal(line.transactionAmount),
        exchangeRate,
        baseAmount,
        paymentSourceType: line.paymentSourceType,
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        departmentId: line.departmentId,
        sourceDocumentType: line.sourceDocumentType,
        sourceDocumentId: line.sourceDocumentId,
        prepaidCandidate: line.prepaidCandidate ?? (category.prepaidEligible && Boolean(line.prepaidCandidate)),
        capitalizableCandidate: line.capitalizableCandidate ?? (category.capitalizableEligible && Boolean(line.capitalizableCandidate)),
      };
    });

    await this.ensureSequence(tenantId);
    const created = await this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, EXPENSE_CLAIM_TYPE, claimDate, tx);
      const claim = await tx.expenseClaim.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          employmentId: dto.employmentId,
          responsiblePersonId: dto.responsiblePersonId,
          claimDate,
          documentDate: claimDate,
          expensePeriodStart: dto.expensePeriodStart ? new Date(dto.expensePeriodStart) : undefined,
          expensePeriodEnd: dto.expensePeriodEnd ? new Date(dto.expensePeriodEnd) : undefined,
          currencyId: dto.currencyId,
          comment: dto.comment,
          responsibleManagerId: dto.responsibleManagerId,
          totalClaimedAmount: totalClaimed,
          createdBy: userId,
          lines: { create: lineData },
        },
        include: { lines: true },
      });
      return claim;
    });

    await this.audit.record({
      tenantId,
      eventType: 'EXPENSE_CLAIM_CREATED',
      entityType: ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { totalClaimedAmount: totalClaimed.toFixed(2), lineCount: created.lines.length },
    });
    return created;
  }

  /** Submit runs policy/receipt/business-purpose validation and moves the
   * claim to PENDING_APPROVAL — spec section 17: "Silent approval etmə",
   * so a blocking violation refuses the transition outright rather than
   * silently letting it through. */
  async submit(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: SubmitExpenseClaimDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const claim = await this.get(tenantId, membershipId, organizationId, id);
    if (claim.claimStatus !== 'DRAFT')
      throw new ValidationAppError(`Cannot submit an expense claim in status ${claim.claimStatus}`);
    if (claim.version !== dto.expectedVersion) throw new ConcurrencyConflictError();

    const violations = await this.validation.validateClaim(tenantId, organizationId, claim);
    const blocking = violations.filter((v) => v.blocking);
    if (blocking.length > 0)
      throw new ValidationAppError(`Cannot submit: ${blocking.map((v) => v.message).join('; ')}`);

    for (const v of violations) {
      await this.prisma.expenseClaimLine.update({
        where: { id: v.lineId },
        data: { policyStatus: v.exceeded ? 'EXCEEDED' : 'OK' },
      });
    }

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: { claimStatus: 'PENDING_APPROVAL', status: 'ACTIVE', version: { increment: 1 } },
      include: { lines: true },
    });
    await this.audit.record({
      tenantId,
      eventType: 'EXPENSE_CLAIM_SUBMITTED',
      entityType: ENTITY_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { policyExceptions: violations.filter((v) => v.exceeded).length },
    });
    return updated;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: EXPENSE_CLAIM_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: EXPENSE_CLAIM_TYPE, documentType: EXPENSE_CLAIM_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race — fine.
    }
  }
}
