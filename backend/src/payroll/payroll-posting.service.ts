import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError, NotFoundAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';

const POSTING_SOURCE_TYPE = 'PAYROLL_CALCULATION_RUN';

/**
 * PayrollPostingService (spec sections 99-103, 112-118). Posts ONE
 * consolidated GL batch per calculation run — Dr Salary Expense / Dr
 * Employer Contribution Expense / Cr Employee Net Payable / Cr Income Tax
 * Payable / Cr Social/Unemployment/Medical Insurance Payable / Cr Other
 * Deduction Payable — and writes one `PayrollLiability` row per
 * employment per liability type (spec section 99's own subledger). GL
 * posting and liability creation happen in the SAME transaction so a
 * partial write never leaves the ledger and the subledger out of step
 * (spec section 117 — "Total Debit = Total Credit" is enforced by
 * `AccountingPostingEngine` itself; this service only ever balances
 * because Σ deductions + net always equals gross by construction).
 * If `SALARY_EXPENSE`/`EMPLOYEE_NET_PAYABLE` aren't mapped yet, the GL
 * batch is skipped (`postingBatchId` stays null) but liabilities are
 * still created — the same "physical fact isn't blocked by a missing
 * account mapping" convention every other posting handler in this
 * codebase follows.
 */
@Injectable()
export class PayrollPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly postingEngine: AccountingPostingEngine,
  ) {}

  async post(tenantId: string, membershipId: string, organizationId: string, userId: string, calculationRunId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const run = await this.prisma.payrollCalculationRun.findFirst({ where: { id: calculationRunId, tenantId, organizationId } });
    if (!run) throw new NotFoundAppError('PayrollCalculationRun', calculationRunId);
    if (run.status === 'POSTED') throw new ValidationAppError('Run is already posted');
    if (run.status !== 'CALCULATED') throw new ValidationAppError(`Run must be CALCULATED before posting (currently ${run.status})`);
    const period = await this.prisma.payrollPeriod.findFirstOrThrow({ where: { id: run.payrollPeriodId } });

    const results = await this.prisma.payrollCalculationResult.findMany({ where: { tenantId, calculationRunId, status: 'CALCULATED' }, include: { lines: true } });
    if (results.length === 0) throw new ValidationAppError('Nothing to post — no CALCULATED results on this run');

    const businessDate = period.periodEnd;
    const salaryExpenseAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SALARY_EXPENSE, businessDate).catch(() => null);
    const netPayableAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.EMPLOYEE_NET_PAYABLE, businessDate).catch(() => null);
    // The physical fact (money owed to employees/authorities) is never
    // blocked by a missing account mapping (same convention as every
    // other posting handler in this codebase) — liabilities are still
    // created below even if the GL batch itself is skipped here.
    const incomeTaxAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.INCOME_TAX_PAYABLE, businessDate).catch(() => null);
    const socialAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SOCIAL_INSURANCE_PAYABLE, businessDate).catch(() => null);
    const unemploymentAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.UNEMPLOYMENT_INSURANCE_PAYABLE, businessDate).catch(() => null);
    const medicalAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.MEDICAL_INSURANCE_PAYABLE, businessDate).catch(() => null);
    const otherDeductionAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_DEDUCTION_PAYABLE, businessDate).catch(() => null);
    const employerContributionExpenseAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.EMPLOYER_CONTRIBUTION_EXPENSE, businessDate).catch(() => null);

    const totals = { gross: new Decimal(0), incomeTax: new Decimal(0), social: new Decimal(0), unemployment: new Decimal(0), medical: new Decimal(0), other: new Decimal(0), net: new Decimal(0), employerContribution: new Decimal(0) };
    for (const r of results) {
      totals.gross = totals.gross.plus(r.gross.toString());
      totals.net = totals.net.plus(r.net.toString());
      totals.employerContribution = totals.employerContribution.plus(r.employerContributions.toString());
      for (const line of r.lines) {
        if (line.lineType !== 'DEDUCTION') continue;
        const amount = new Decimal(line.amount.toString());
        if (line.calculationCode === 'INCOME_TAX') totals.incomeTax = totals.incomeTax.plus(amount);
        else if (line.calculationCode === 'EMPLOYEE_SOCIAL_INSURANCE') totals.social = totals.social.plus(amount);
        else if (line.calculationCode === 'EMPLOYEE_UNEMPLOYMENT_INSURANCE') totals.unemployment = totals.unemployment.plus(amount);
        else if (line.calculationCode === 'EMPLOYEE_MEDICAL_INSURANCE') totals.medical = totals.medical.plus(amount);
        else totals.other = totals.other.plus(amount);
      }
    }

    return this.prisma.runInTransaction(async (tx) => {
      let batch: { id: string } | null = null;
      if (salaryExpenseAccount && netPayableAccount) {
        const lines: { accountId: string; side: 'DEBIT' | 'CREDIT'; amountBase: Decimal; description: string }[] = [];
        lines.push({ accountId: salaryExpenseAccount.id, side: 'DEBIT', amountBase: totals.gross, description: 'Payroll salary expense' });
        if (totals.employerContribution.gt(0) && employerContributionExpenseAccount) lines.push({ accountId: employerContributionExpenseAccount.id, side: 'DEBIT', amountBase: totals.employerContribution, description: 'Payroll employer contribution expense' });
        lines.push({ accountId: netPayableAccount.id, side: 'CREDIT', amountBase: totals.net, description: 'Employee net pay payable' });
        if (totals.incomeTax.gt(0) && incomeTaxAccount) lines.push({ accountId: incomeTaxAccount.id, side: 'CREDIT', amountBase: totals.incomeTax, description: 'Income tax payable' });
        // Employee + employer social/unemployment/medical insurance share the
        // same payable account by default (disclosed simplification, see
        // docs/PAYROLL.md) — summed together below.
        const employerSocial = results.reduce((s, r) => s.plus(r.lines.filter((l) => l.calculationCode === 'EMPLOYER_SOCIAL_INSURANCE').reduce((s2, l) => s2.plus(l.amount.toString()), new Decimal(0))), new Decimal(0));
        const employerUnemployment = results.reduce((s, r) => s.plus(r.lines.filter((l) => l.calculationCode === 'EMPLOYER_UNEMPLOYMENT_INSURANCE').reduce((s2, l) => s2.plus(l.amount.toString()), new Decimal(0))), new Decimal(0));
        const employerMedical = results.reduce((s, r) => s.plus(r.lines.filter((l) => l.calculationCode === 'EMPLOYER_MEDICAL_INSURANCE').reduce((s2, l) => s2.plus(l.amount.toString()), new Decimal(0))), new Decimal(0));
        if (totals.social.plus(employerSocial).gt(0) && socialAccount) lines.push({ accountId: socialAccount.id, side: 'CREDIT', amountBase: totals.social.plus(employerSocial), description: 'Social insurance payable (employee + employer)' });
        if (totals.unemployment.plus(employerUnemployment).gt(0) && unemploymentAccount) lines.push({ accountId: unemploymentAccount.id, side: 'CREDIT', amountBase: totals.unemployment.plus(employerUnemployment), description: 'Unemployment insurance payable (employee + employer)' });
        if (totals.medical.plus(employerMedical).gt(0) && medicalAccount) lines.push({ accountId: medicalAccount.id, side: 'CREDIT', amountBase: totals.medical.plus(employerMedical), description: 'Medical insurance payable (employee + employer)' });
        if (totals.other.gt(0) && otherDeductionAccount) lines.push({ accountId: otherDeductionAccount.id, side: 'CREDIT', amountBase: totals.other, description: 'Other payroll deduction payable' });

        const debitTotal = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s.plus(l.amountBase), new Decimal(0));
        const creditTotal = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s.plus(l.amountBase), new Decimal(0));
        if (!debitTotal.eq(creditTotal)) throw new ValidationAppError(`Payroll posting batch does not balance (debit ${debitTotal.toString()} vs credit ${creditTotal.toString()}) — an account mapping is likely missing for one of the deduction types.`);

        batch = await this.postingEngine.postBatch(tenantId, userId, { organizationId, businessDate, description: `Payroll ${period.year}-${String(period.month).padStart(2, '0')}`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: POSTING_SOURCE_TYPE, sourceDocumentId: run.id, lines: lines.map((l) => ({ accountId: l.accountId, side: l.side, amountBase: l.amountBase, description: l.description })) }, tx);
      }

      for (const r of results) {
        await tx.payrollCalculationResult.update({ where: { id: r.id }, data: { status: 'POSTED' } });
        await this.createLiability(tx, tenantId, organizationId, r.employmentId, 'EMPLOYEE_NET_PAY', null, period.id, r.id, period.paymentDate, new Decimal(r.net.toString()));
        for (const line of r.lines.filter((l) => l.lineType === 'DEDUCTION')) {
          const liabilityType = this.deductionToLiabilityType(line.calculationCode);
          await this.createLiability(tx, tenantId, organizationId, r.employmentId, liabilityType, liabilityType === 'ALIMONY_PAYABLE' || liabilityType === 'OTHER_DEDUCTION_PAYABLE' ? line.calculationCode : null, period.id, r.id, period.paymentDate, new Decimal(line.amount.toString()));
        }
        for (const line of r.lines.filter((l) => l.lineType === 'EMPLOYER_CONTRIBUTION')) {
          const liabilityType = line.calculationCode.includes('SOCIAL') ? 'SOCIAL_INSURANCE_PAYABLE' : line.calculationCode.includes('UNEMPLOYMENT') ? 'UNEMPLOYMENT_INSURANCE_PAYABLE' : 'MEDICAL_INSURANCE_PAYABLE';
          await this.createLiability(tx, tenantId, organizationId, r.employmentId, liabilityType, null, period.id, r.id, period.paymentDate, new Decimal(line.amount.toString()));
        }
      }

      const posted = await tx.payrollCalculationRun.update({ where: { id: run.id }, data: { status: 'POSTED', postingBatchId: batch?.id } });
      await tx.payrollPeriod.update({ where: { id: period.id }, data: { status: 'POSTED', postedAt: new Date() } });
      await this.audit.record({ tenantId, eventType: 'PAYROLL_POSTED', entityType: 'PAYROLL_CALCULATION_RUN', entityId: run.id, action: 'UPDATE', userId, newValues: { gross: totals.gross.toString(), net: totals.net.toString(), glPosted: !!batch } }, tx);
      return posted;
    });
  }

  private deductionToLiabilityType(code: string): string {
    switch (code) {
      case 'INCOME_TAX': return 'INCOME_TAX_PAYABLE';
      case 'EMPLOYEE_SOCIAL_INSURANCE': return 'SOCIAL_INSURANCE_PAYABLE';
      case 'EMPLOYEE_UNEMPLOYMENT_INSURANCE': return 'UNEMPLOYMENT_INSURANCE_PAYABLE';
      case 'EMPLOYEE_MEDICAL_INSURANCE': return 'MEDICAL_INSURANCE_PAYABLE';
      case 'ALIMONY': return 'ALIMONY_PAYABLE';
      case 'UNION_DUES': return 'UNION_DUES_PAYABLE';
      default: return 'OTHER_DEDUCTION_PAYABLE';
    }
  }

  private async createLiability(tx: any, tenantId: string, organizationId: string, employmentId: string, liabilityType: string, creditor: string | null, payrollPeriodId: string, sourceResultId: string, dueDate: Date | null, accrued: Decimal) {
    if (accrued.lte(0)) return;
    const currencyResult = await tx.payrollCalculationResult.findUniqueOrThrow({ where: { id: sourceResultId } });
    await tx.payrollLiability.create({ data: { tenantId, organizationId, employmentId, liabilityType, creditor, currencyId: currencyResult.currencyId, payrollPeriodId, sourceResultId, dueDate, accrued: accrued.toString(), outstanding: accrued.toString(), status: 'OPEN' } });
  }
}
