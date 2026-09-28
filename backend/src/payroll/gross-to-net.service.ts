import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollLegalRulesService } from './payroll-legal-rules.service';
import { PayrollExecutionOrderService } from './payroll-execution-order.service';
import { DeductionCodes, EmployerContributionCodes } from './payroll-codes';
import { AZ_INCOME_TAX_RULE_CODE } from './az-payroll-localization.data';
import { ResultLineDraft } from './payroll-result-line.types';

export interface GrossToNetResult {
  gross: Decimal;
  taxableIncome: Decimal;
  employeeDeductions: Decimal;
  net: Decimal;
  employerContributions: Decimal;
  employerTotalCost: Decimal;
  lines: ResultLineDraft[];
}

/**
 * GrossToNetService (docx spec Phase 19 sections 47, 54-62) — separate
 * taxable/social/unemployment/medical bases (never "contribution base =
 * gross"), employee deductions computed strictly in statutory priority
 * order (never an arbitrary UI order), employer contributions computed
 * and added to employer cost WITHOUT ever reducing the employee's net
 * (spec section 54: employee and employer contributions are never mixed).
 */
@Injectable()
export class GrossToNetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legalRules: PayrollLegalRulesService,
    private readonly executionOrders: PayrollExecutionOrderService,
  ) {}

  async compute(
    tenantId: string,
    employmentId: string,
    earningLines: ResultLineDraft[],
    asOfDate: Date,
    taxProfile: { exemptionCodes?: unknown; mainWorkplace: boolean },
  ): Promise<GrossToNetResult> {
    const exemptionCodes: string[] = Array.isArray(taxProfile.exemptionCodes)
      ? (taxProfile.exemptionCodes as string[])
      : [];
    const earningCodes = Array.from(new Set(earningLines.map((l) => l.calculationCode)));
    const definitions = await this.prisma.payrollEarningDefinition.findMany({
      where: { tenantId, code: { in: earningCodes } },
    });
    const defByCode = new Map(definitions.map((d) => [d.code, d]));

    const sumWhere = (predicate: (d: (typeof definitions)[number]) => boolean) =>
      earningLines.reduce((sum, l) => {
        const def = defByCode.get(l.calculationCode);
        if (def && predicate(def)) return sum.plus(l.amount);
        return sum;
      }, new Decimal(0));

    const gross = sumWhere((d) => d.grossPayInclusion);
    let taxableIncome = sumWhere((d) => d.taxableIncome);
    const socialBase = sumWhere((d) => d.socialInsuranceBase);
    const unemploymentBase = sumWhere((d) => d.unemploymentBase);
    const medicalBase = sumWhere((d) => d.medicalInsuranceBase);

    const reliefs = await this.legalRules.resolveTaxReliefs(
      tenantId,
      exemptionCodes,
      asOfDate,
      taxProfile.mainWorkplace,
    );
    const totalRelief = reliefs.reduce((sum, r) => sum.plus(r.amount?.toString() ?? '0'), new Decimal(0));
    taxableIncome = Decimal.max(0, taxableIncome.minus(totalRelief));

    const lines: ResultLineDraft[] = [];

    const taxBrackets = await this.legalRules.resolveTaxBrackets(tenantId, AZ_INCOME_TAX_RULE_CODE, asOfDate);
    const incomeTax = this.legalRules.computeProgressive(
      taxBrackets.map((b) => ({ fromAmount: new Decimal(b.fromAmount.toString()), toAmount: b.toAmount ? new Decimal(b.toAmount.toString()) : null, rate: new Decimal(b.rate.toString()) })),
      taxableIncome,
    ).toDecimalPlaces(2);
    if (incomeTax.gt(0))
      lines.push({
        calculationCode: DeductionCodes.INCOME_TAX,
        lineType: 'DEDUCTION',
        baseAmount: taxableIncome,
        amount: incomeTax,
        sourceRule: AZ_INCOME_TAX_RULE_CODE,
        explanation: `Progressive tax on taxable base ${taxableIncome.toFixed(2)}${totalRelief.gt(0) ? ` (after ${totalRelief.toFixed(2)} relief)` : ''}`,
      });

    const employeeSocial = await this.computeContribution(tenantId, 'SOCIAL_INSURANCE', 'EMPLOYEE', socialBase, asOfDate);
    if (employeeSocial.gt(0))
      lines.push(this.contributionLine(DeductionCodes.EMPLOYEE_SOCIAL_INSURANCE, socialBase, employeeSocial, 'DEDUCTION'));

    const employeeUnemployment = await this.computeContribution(tenantId, 'UNEMPLOYMENT', 'EMPLOYEE', unemploymentBase, asOfDate);
    if (employeeUnemployment.gt(0))
      lines.push(this.contributionLine(DeductionCodes.EMPLOYEE_UNEMPLOYMENT_INSURANCE, unemploymentBase, employeeUnemployment, 'DEDUCTION'));

    const employeeMedical = await this.computeContribution(tenantId, 'MEDICAL_INSURANCE', 'EMPLOYEE', medicalBase, asOfDate);
    if (employeeMedical.gt(0))
      lines.push(this.contributionLine(DeductionCodes.EMPLOYEE_MEDICAL_INSURANCE, medicalBase, employeeMedical, 'DEDUCTION'));

    const netBeforeExecutionOrders = gross.minus(incomeTax).minus(employeeSocial).minus(employeeUnemployment).minus(employeeMedical);
    const { lines: executionLines, remaining: netAfterExecutionOrders } = await this.executionOrders.resolveDeductions(
      tenantId,
      employmentId,
      gross,
      Decimal.max(0, netBeforeExecutionOrders),
      asOfDate,
    );
    lines.push(...executionLines);

    const employeeDeductions = incomeTax.plus(employeeSocial).plus(employeeUnemployment).plus(employeeMedical).plus(
      executionLines.reduce((sum, l) => sum.plus(l.amount), new Decimal(0)),
    );
    const net = netAfterExecutionOrders;

    const employerSocial = await this.computeContribution(tenantId, 'SOCIAL_INSURANCE', 'EMPLOYER', socialBase, asOfDate);
    const employerUnemployment = await this.computeContribution(tenantId, 'UNEMPLOYMENT', 'EMPLOYER', unemploymentBase, asOfDate);
    const employerMedical = await this.computeContribution(tenantId, 'MEDICAL_INSURANCE', 'EMPLOYER', medicalBase, asOfDate);
    if (employerSocial.gt(0))
      lines.push(this.contributionLine(EmployerContributionCodes.EMPLOYER_SOCIAL_INSURANCE, socialBase, employerSocial, 'EMPLOYER_CONTRIBUTION'));
    if (employerUnemployment.gt(0))
      lines.push(this.contributionLine(EmployerContributionCodes.EMPLOYER_UNEMPLOYMENT_INSURANCE, unemploymentBase, employerUnemployment, 'EMPLOYER_CONTRIBUTION'));
    if (employerMedical.gt(0))
      lines.push(this.contributionLine(EmployerContributionCodes.EMPLOYER_MEDICAL_INSURANCE, medicalBase, employerMedical, 'EMPLOYER_CONTRIBUTION'));

    const employerContributions = employerSocial.plus(employerUnemployment).plus(employerMedical);
    const employerTotalCost = gross.plus(employerContributions);

    return {
      gross: gross.toDecimalPlaces(2),
      taxableIncome: taxableIncome.toDecimalPlaces(2),
      employeeDeductions: employeeDeductions.toDecimalPlaces(2),
      net: net.toDecimalPlaces(2),
      employerContributions: employerContributions.toDecimalPlaces(2),
      employerTotalCost: employerTotalCost.toDecimalPlaces(2),
      lines,
    };
  }

  private async computeContribution(
    tenantId: string,
    contributionType: string,
    payerType: 'EMPLOYEE' | 'EMPLOYER',
    base: Decimal,
    asOfDate: Date,
  ): Promise<Decimal> {
    const brackets = await this.legalRules.resolveContributionBrackets(tenantId, contributionType, payerType, asOfDate);
    return this.legalRules
      .computeContribution(
        brackets.map((b) => ({ thresholdFrom: new Decimal(b.thresholdFrom.toString()), thresholdTo: b.thresholdTo ? new Decimal(b.thresholdTo.toString()) : null, percentage: new Decimal(b.percentage.toString()) })),
        base,
      )
      .toDecimalPlaces(2);
  }

  private contributionLine(
    code: string,
    base: Decimal,
    amount: Decimal,
    lineType: ResultLineDraft['lineType'],
  ): ResultLineDraft {
    return {
      calculationCode: code,
      lineType,
      baseAmount: base,
      amount,
      explanation: `Contribution on base ${base.toFixed(2)}`,
    };
  }
}
