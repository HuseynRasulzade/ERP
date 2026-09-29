import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpensePolicyDto } from './dto/expenses.dto';

/**
 * ExpensePolicyService (docx spec Phase 20 sections 9-10) — effective-
 * dated rule rows, never a hardcoded per-category limit. `resolve()`
 * picks the most specific matching row for (organization, category, and
 * whatever finer dimensions the caller supplies) as of a date — same
 * precedence idea as `AccountingMappingService.resolve`: more matching
 * dimensions and higher `priority` win over a broader default row.
 */
@Injectable()
export class ExpensePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, organizationId?: string) {
    return this.prisma.expensePolicy.findMany({
      where: { tenantId, ...(organizationId ? { OR: [{ organizationId }, { organizationId: null }] } : {}) },
      orderBy: { priority: 'desc' },
    });
  }

  create(tenantId: string, organizationId: string | null, dto: CreateExpensePolicyDto) {
    return this.prisma.expensePolicy.create({
      data: {
        tenantId,
        organizationId,
        expenseCategoryId: dto.expenseCategoryId,
        employeeGrade: dto.employeeGrade,
        positionId: dto.positionId,
        departmentId: dto.departmentId,
        travelType: dto.travelType,
        country: dto.country,
        city: dto.city,
        paymentMethod: dto.paymentMethod,
        currencyId: dto.currencyId,
        maxAmount: dto.maxAmount,
        maxAmountPeriod: dto.maxAmountPeriod,
        receiptRequiredOverride: dto.receiptRequiredOverride,
        businessPurposeRequired: dto.businessPurposeRequired,
        priority: dto.priority ?? 100,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      },
    });
  }

  /** Resolves every policy row applicable to a claim line's category/date
   * (organization-specific rows beat tenant-wide ones at equal
   * specificity), most specific/highest-priority first. Callers combine
   * the max-amount rows themselves (spec gives no single-winner rule for
   * "the" limit — each dimension can independently cap the line). */
  async resolveForCategory(
    tenantId: string,
    organizationId: string,
    expenseCategoryId: string,
    asOfDate: Date,
  ) {
    const rows = await this.prisma.expensePolicy.findMany({
      where: {
        tenantId,
        active: true,
        OR: [{ organizationId }, { organizationId: null }],
        AND: [{ OR: [{ expenseCategoryId }, { expenseCategoryId: null }] }],
        effectiveFrom: { lte: asOfDate },
      },
    });
    // effectiveTo (nullable = open-ended) is filtered here rather than a
    // second `OR` group in the same query, to keep the Prisma `where`
    // shape simple.
    return rows
      .filter((r) => !r.effectiveTo || r.effectiveTo >= asOfDate)
      .sort((a, b) => {
        const specificityA = (a.organizationId ? 1 : 0) + (a.expenseCategoryId ? 1 : 0);
        const specificityB = (b.organizationId ? 1 : 0) + (b.expenseCategoryId ? 1 : 0);
        if (specificityA !== specificityB) return specificityB - specificityA;
        return b.priority - a.priority;
      });
  }
}
