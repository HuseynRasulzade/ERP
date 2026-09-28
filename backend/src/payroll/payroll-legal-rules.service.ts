import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import {
  CreateContributionBracketDto,
  CreateLegalRuleSetDto,
  CreateTaxBracketDto,
  CreateTaxReliefDto,
} from './dto/payroll.dto';
import {
  AZ_EFFECTIVE_FROM,
  AZ_INCOME_TAX_BRACKETS,
  AZ_INCOME_TAX_RULE_CODE,
  AZ_LEGAL_RULE_SETS,
  AZ_MEDICAL_INSURANCE_BRACKETS,
  AZ_SOCIAL_INSURANCE_BRACKETS,
  AZ_UNEMPLOYMENT_BRACKETS,
} from './az-payroll-localization.data';

/**
 * PayrollLegalRulesService — PayrollLegalRuleSet / PayrollTaxBracket /
 * PayrollContributionBracket / PayrollTaxRelief (docx spec Phase 19
 * sections 4-5, 47-58). A historical payroll always resolves the bracket
 * ROWS effective during that period (`effectiveFrom <= date <= effectiveTo
 * or open`) — never today's rates. Rates are never hardcoded here; the
 * 2026 AZ non-oil private-sector example rates (spec sections 51/55/57/58)
 * live entirely in `prisma/seed.ts`'s az-payroll-localization block as
 * DATA, not code.
 *
 * Both `PayrollTaxBracket.rate` and `PayrollContributionBracket.percentage`
 * store a fraction (0.03 = 3%), not a whole-number percentage.
 */
@Injectable()
export class PayrollLegalRulesService {
  constructor(private readonly prisma: PrismaService) {}

  createRuleSet(tenantId: string, userId: string, dto: CreateLegalRuleSetDto) {
    return this.prisma.payrollLegalRuleSet.create({
      data: {
        tenantId,
        jurisdiction: dto.jurisdiction ?? 'AZ',
        ruleCode: dto.ruleCode,
        legalSource: dto.legalSource,
        articleReference: dto.articleReference,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? this.parseDate(dto.effectiveTo) : undefined,
        ruleVersion: dto.ruleVersion ?? 1,
        approvedBy: userId,
      },
    });
  }

  listRuleSets(tenantId: string) {
    return this.prisma.payrollLegalRuleSet.findMany({
      where: { tenantId },
      orderBy: [{ ruleCode: 'asc' }, { ruleVersion: 'desc' }],
    });
  }

  createTaxBracket(tenantId: string, dto: CreateTaxBracketDto) {
    return this.prisma.payrollTaxBracket.create({
      data: {
        tenantId,
        ruleCode: dto.ruleCode,
        regime: dto.regime,
        fromAmount: new Decimal(dto.fromAmount),
        toAmount: dto.toAmount !== undefined ? new Decimal(dto.toAmount) : undefined,
        baseTax: dto.baseTax !== undefined ? new Decimal(dto.baseTax) : undefined,
        rate: new Decimal(dto.rate),
        sequence: dto.sequence,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? this.parseDate(dto.effectiveTo) : undefined,
      },
    });
  }

  async resolveTaxBrackets(tenantId: string, ruleCode: string, asOfDate: Date) {
    return this.prisma.payrollTaxBracket.findMany({
      where: {
        tenantId,
        ruleCode,
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { sequence: 'asc' },
    });
  }

  /** Generic progressive-bracket sum — never `income * flatRate` (spec
   * section 180: "No single flat rate"). */
  computeProgressive(brackets: { fromAmount: Decimal; toAmount: Decimal | null; rate: Decimal }[], amount: Decimal): Decimal {
    let total = new Decimal(0);
    for (const b of brackets) {
      if (amount.lte(b.fromAmount)) continue;
      const upper = b.toAmount ? Decimal.min(amount, b.toAmount) : amount;
      const portion = upper.minus(b.fromAmount);
      if (portion.gt(0)) total = total.plus(portion.times(b.rate));
    }
    return total;
  }

  createContributionBracket(tenantId: string, dto: CreateContributionBracketDto) {
    return this.prisma.payrollContributionBracket.create({
      data: {
        tenantId,
        contributionType: dto.contributionType,
        payerType: dto.payerType,
        regime: dto.regime,
        thresholdFrom: new Decimal(dto.thresholdFrom),
        thresholdTo: dto.thresholdTo !== undefined ? new Decimal(dto.thresholdTo) : undefined,
        fixedComponent: dto.fixedComponent !== undefined ? new Decimal(dto.fixedComponent) : undefined,
        percentage: new Decimal(dto.percentage),
        sequence: dto.sequence,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? this.parseDate(dto.effectiveTo) : undefined,
      },
    });
  }

  async resolveContributionBrackets(
    tenantId: string,
    contributionType: string,
    payerType: string,
    asOfDate: Date,
  ) {
    return this.prisma.payrollContributionBracket.findMany({
      where: {
        tenantId,
        contributionType,
        payerType,
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { sequence: 'asc' },
    });
  }

  computeContribution(
    brackets: { thresholdFrom: Decimal; thresholdTo: Decimal | null; percentage: Decimal }[],
    amount: Decimal,
  ): Decimal {
    let total = new Decimal(0);
    for (const b of brackets) {
      if (amount.lte(b.thresholdFrom)) continue;
      const upper = b.thresholdTo ? Decimal.min(amount, b.thresholdTo) : amount;
      const portion = upper.minus(b.thresholdFrom);
      if (portion.gt(0)) total = total.plus(portion.times(b.percentage));
    }
    return total;
  }

  createTaxRelief(tenantId: string, dto: CreateTaxReliefDto) {
    return this.prisma.payrollTaxRelief.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        amount: dto.amount !== undefined ? new Decimal(dto.amount) : undefined,
        priority: dto.priority ?? 100,
        combinability: dto.combinability,
        mainWorkplaceRequired: dto.mainWorkplaceRequired ?? false,
        legalReference: dto.legalReference,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? this.parseDate(dto.effectiveTo) : undefined,
      },
    });
  }

  async resolveTaxReliefs(tenantId: string, codes: string[], asOfDate: Date, mainWorkplace: boolean) {
    if (codes.length === 0) return [];
    const reliefs = await this.prisma.payrollTaxRelief.findMany({
      where: {
        tenantId,
        code: { in: codes },
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { priority: 'asc' },
    });
    const eligible = reliefs.filter((r) => !r.mainWorkplaceRequired || mainWorkplace);

    const largestOnly = eligible.filter((r) => r.combinability === 'LARGEST_ONLY');
    const mutuallyExclusive = eligible.filter((r) => r.combinability === 'MUTUALLY_EXCLUSIVE');
    const additive = eligible.filter((r) => r.combinability === 'ADDITIVE');

    const result = [...additive];
    if (largestOnly.length > 0) {
      const best = largestOnly.reduce((a, b) => ((a.amount?.toNumber() ?? 0) >= (b.amount?.toNumber() ?? 0) ? a : b));
      result.push(best);
    }
    if (mutuallyExclusive.length > 0) result.push(mutuallyExclusive[0]);
    return result;
  }

  /** Loads the illustrative 2026 AZ non-oil private-sector rates as
   * effective-dated seed data (see az-payroll-localization.data.ts's own
   * doc comment on their provisional nature). Idempotent. */
  async seedAzLocalization2026(tenantId: string, userId: string) {
    for (const rs of AZ_LEGAL_RULE_SETS) {
      const existing = await this.prisma.payrollLegalRuleSet.findUnique({
        where: { tenantId_ruleCode_ruleVersion: { tenantId, ruleCode: rs.ruleCode, ruleVersion: 1 } },
      });
      if (!existing) {
        await this.prisma.payrollLegalRuleSet.create({
          data: {
            tenantId,
            ruleCode: rs.ruleCode,
            legalSource: rs.legalSource,
            articleReference: rs.articleReference,
            effectiveFrom: AZ_EFFECTIVE_FROM,
            approvedBy: userId,
          },
        });
      }
    }

    const existingTaxBrackets = await this.prisma.payrollTaxBracket.findFirst({
      where: { tenantId, ruleCode: AZ_INCOME_TAX_RULE_CODE, effectiveFrom: AZ_EFFECTIVE_FROM },
    });
    if (!existingTaxBrackets) {
      for (const b of AZ_INCOME_TAX_BRACKETS) {
        await this.prisma.payrollTaxBracket.create({
          data: {
            tenantId,
            ruleCode: AZ_INCOME_TAX_RULE_CODE,
            fromAmount: new Decimal(b.fromAmount),
            toAmount: b.toAmount !== null ? new Decimal(b.toAmount) : undefined,
            rate: new Decimal(b.rate),
            sequence: b.sequence,
            effectiveFrom: AZ_EFFECTIVE_FROM,
          },
        });
      }
    }

    const contributionSets: Array<[string, 'EMPLOYEE' | 'EMPLOYER', typeof AZ_SOCIAL_INSURANCE_BRACKETS.EMPLOYEE]> = [
      ['SOCIAL_INSURANCE', 'EMPLOYEE', AZ_SOCIAL_INSURANCE_BRACKETS.EMPLOYEE],
      ['SOCIAL_INSURANCE', 'EMPLOYER', AZ_SOCIAL_INSURANCE_BRACKETS.EMPLOYER],
      ['UNEMPLOYMENT', 'EMPLOYEE', AZ_UNEMPLOYMENT_BRACKETS.EMPLOYEE],
      ['UNEMPLOYMENT', 'EMPLOYER', AZ_UNEMPLOYMENT_BRACKETS.EMPLOYER],
      ['MEDICAL_INSURANCE', 'EMPLOYEE', AZ_MEDICAL_INSURANCE_BRACKETS.EMPLOYEE],
      ['MEDICAL_INSURANCE', 'EMPLOYER', AZ_MEDICAL_INSURANCE_BRACKETS.EMPLOYER],
    ];
    for (const [contributionType, payerType, brackets] of contributionSets) {
      const existing = await this.prisma.payrollContributionBracket.findFirst({
        where: { tenantId, contributionType, payerType, effectiveFrom: AZ_EFFECTIVE_FROM },
      });
      if (existing) continue;
      for (const b of brackets) {
        await this.prisma.payrollContributionBracket.create({
          data: {
            tenantId,
            contributionType,
            payerType,
            thresholdFrom: new Decimal(b.thresholdFrom),
            thresholdTo: b.thresholdTo !== null ? new Decimal(b.thresholdTo) : undefined,
            percentage: new Decimal(b.percentage),
            sequence: b.sequence,
            effectiveFrom: AZ_EFFECTIVE_FROM,
          },
        });
      }
    }

    return { status: 'seeded' };
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
