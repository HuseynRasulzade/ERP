import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { EmploymentService } from '../hr-core/employment.service';
import { PAYROLL_POSTING_TYPE } from './payroll-posting.repository';
import { PayrollLiabilityService } from './payroll-liability.service';
import { EMPLOYER_CONTRIBUTION_PAYABLE_MAPPING } from './payroll-codes';

/**
 * Posting handler for PayrollPosting (docx spec Phase 19 sections 97-103,
 * 114) — the sixth participant in the document-framework's generic post/
 * unpost/repost engine (after Stock/Cash/Bank/FixedAsset/WorkTime-adjacent
 * documents). One GL entry per period:
 *
 *   Dr Salary Expense (per department)         = sum(EARNING lines)
 *   Dr Employer Contribution Expense (per dept) = sum(EMPLOYER_CONTRIBUTION lines)
 *   Cr Salary Payable                           = sum(net)
 *   Cr <statutory payable per DEDUCTION code>   = sum(DEDUCTION lines by code)
 *   Cr <statutory payable per EMPLOYER_CONTRIBUTION code> = sum(those lines)
 *
 * Balanced by construction: net = gross - sum(DEDUCTION lines), so
 * Dr(gross + employerContributions) always equals
 * Cr(net + deductions + employerContributions). Expense lines are
 * dimensioned by DEPARTMENT (spec section 114); payable lines are not —
 * per-employee/per-order detail lives in the PAYROLL_LIABILITY_REGISTER
 * and PayrollResultLine, not as GL dimensions (disclosed simplification,
 * same convention FixedAssetDisposal used for ACCUMULATED_DEPRECIATION).
 * Disclosed simplification: department is resolved ONCE per employment
 * as of the posting's business date (EmploymentService.getState) — a
 * mid-period department transfer is not sub-split across old/new
 * department the way a mid-period compensation change already is.
 */
@Injectable()
export class PayrollPostingHandler implements DocumentPostingHandler {
  readonly documentType = PAYROLL_POSTING_TYPE;

  constructor(
    private readonly mappings: AccountingMappingService,
    private readonly employments: EmploymentService,
    private readonly liability: PayrollLiabilityService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const posting = await tx.payrollPosting.findFirst({ where: { id: document.id, tenantId } });
    if (!posting) throw new ValidationAppError('Document disappeared during posting');
    const period = await tx.payrollPeriod.findFirst({ where: { id: posting.payrollPeriodId, tenantId } });
    if (!period) throw new ValidationAppError('Payroll period not found');
    if (period.status !== 'APPROVED')
      throw new ValidationAppError(
        `Cannot post payroll to the GL while the period is in status ${period.status} — approve it first`,
      );
    const resultCount = await tx.payrollCalculationResult.count({
      where: { tenantId, payrollPeriodId: period.id, status: 'CALCULATED' },
    });
    if (resultCount === 0) throw new ValidationAppError('No calculated payroll results to post');
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const posting = await tx.payrollPosting.findFirst({ where: { id: document.id, tenantId } });
    if (!posting) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const results = await tx.payrollCalculationResult.findMany({
      where: { tenantId, payrollPeriodId: posting.payrollPeriodId, status: 'CALCULATED' },
      include: { lines: true },
    });

    const movements: RegisterMovementInput[] = [];
    for (const result of results) {
      const state = await this.employments.getState(result.employmentId, businessDate, tx);
      movements.push(
        ...this.liability.buildIncreaseMovements(
          result,
          { organizationId: posting.organizationId, departmentId: state.departmentId, payrollPeriodId: posting.payrollPeriodId },
          businessDate,
        ),
      );
    }
    return movements;
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const posting = await tx.payrollPosting.findFirst({ where: { id: document.id, tenantId } });
    if (!posting) throw new ValidationAppError('Document disappeared during posting');
    const period = await tx.payrollPeriod.findFirst({ where: { id: posting.payrollPeriodId, tenantId } });
    if (!period) throw new ValidationAppError('Payroll period not found');
    const businessDate = document.postingDate ?? document.documentDate;

    const results = await tx.payrollCalculationResult.findMany({
      where: { tenantId, payrollPeriodId: period.id, status: 'CALCULATED' },
      include: { lines: true },
    });
    if (results.length === 0) throw new ValidationAppError('No calculated payroll results to post');

    const earningCodes = new Set<string>();
    const deductionCodes = new Set<string>();
    for (const r of results)
      for (const l of r.lines) {
        if (l.lineType === 'EARNING') earningCodes.add(l.calculationCode);
        if (l.lineType === 'DEDUCTION') deductionCodes.add(l.calculationCode);
      }
    const [earningDefs, deductionDefs] = await Promise.all([
      tx.payrollEarningDefinition.findMany({ where: { tenantId, code: { in: Array.from(earningCodes) } } }),
      tx.payrollDeductionDefinition.findMany({ where: { tenantId, code: { in: Array.from(deductionCodes) } } }),
    ]);
    const earningMappingByCode = new Map(earningDefs.map((d) => [d.code, d.accountingMappingKey]));
    const deductionMappingByCode = new Map(deductionDefs.map((d) => [d.code, d.accountingMappingKey]));

    const expenseByKey = new Map<string, Decimal>(); // `${mappingKey}|${departmentId}`
    const payableByKey = new Map<string, Decimal>(); // mappingKey
    let totalNet = new Decimal(0);
    const stateCache = new Map<string, string | null>();

    for (const result of results) {
      let departmentId = stateCache.get(result.employmentId);
      if (departmentId === undefined) {
        const state = await this.employments.getState(result.employmentId, businessDate, tx);
        departmentId = state.departmentId;
        stateCache.set(result.employmentId, departmentId);
      }
      for (const line of result.lines) {
        const amount = new Decimal(line.amount.toString());
        if (amount.lte(0)) continue;
        if (line.lineType === 'EARNING') {
          const mappingKey = earningMappingByCode.get(line.calculationCode) ?? MappingKeys.SALARY_EXPENSE;
          const key = `${mappingKey}|${departmentId ?? ''}`;
          expenseByKey.set(key, (expenseByKey.get(key) ?? new Decimal(0)).plus(amount));
        } else if (line.lineType === 'DEDUCTION') {
          const mappingKey = deductionMappingByCode.get(line.calculationCode);
          if (!mappingKey)
            throw new ValidationAppError(
              `Deduction definition ${line.calculationCode} has no accountingMappingKey configured for GL posting`,
            );
          payableByKey.set(mappingKey, (payableByKey.get(mappingKey) ?? new Decimal(0)).plus(amount));
        } else if (line.lineType === 'EMPLOYER_CONTRIBUTION') {
          const payableKey = EMPLOYER_CONTRIBUTION_PAYABLE_MAPPING[line.calculationCode];
          if (!payableKey)
            throw new ValidationAppError(
              `Employer contribution ${line.calculationCode} has no payable mapping configured for GL posting`,
            );
          const expenseKey = `${MappingKeys.EMPLOYER_CONTRIBUTION_EXPENSE}|${departmentId ?? ''}`;
          expenseByKey.set(expenseKey, (expenseByKey.get(expenseKey) ?? new Decimal(0)).plus(amount));
          payableByKey.set(payableKey, (payableByKey.get(payableKey) ?? new Decimal(0)).plus(amount));
        }
      }
      totalNet = totalNet.plus(result.net.toString());
    }

    const lines: AccountingPostingLineInput[] = [];
    for (const [key, amount] of expenseByKey) {
      if (amount.lte(0)) continue;
      const [mappingKey, departmentId] = key.split('|');
      const account = await this.mappings.resolve(tenantId, posting.organizationId, mappingKey, businessDate, tx);
      lines.push({
        accountId: account.id,
        side: 'DEBIT',
        amountBase: amount,
        description: `Payroll posting ${posting.number ?? posting.id}`,
        dimensions: departmentId ? [{ dimensionCode: 'DEPARTMENT', referenceId: departmentId }] : [],
      });
    }
    if (totalNet.gt(0)) {
      const account = await this.mappings.resolve(tenantId, posting.organizationId, MappingKeys.SALARY_PAYABLE, businessDate, tx);
      lines.push({
        accountId: account.id,
        side: 'CREDIT',
        amountBase: totalNet,
        description: `Payroll posting ${posting.number ?? posting.id} — net pay payable`,
        dimensions: [],
      });
    }
    for (const [mappingKey, amount] of payableByKey) {
      if (amount.lte(0)) continue;
      const account = await this.mappings.resolve(tenantId, posting.organizationId, mappingKey, businessDate, tx);
      lines.push({
        accountId: account.id,
        side: 'CREDIT',
        amountBase: amount,
        description: `Payroll posting ${posting.number ?? posting.id}`,
        dimensions: [],
      });
    }

    await tx.payrollPeriod.update({
      where: { id: period.id },
      data: { status: 'POSTED', postedAt: businessDate },
    });

    if (lines.length === 0) return null;
    return {
      description: `Payroll posting ${posting.number ?? posting.id} — period ${period.year}-${String(period.month).padStart(2, '0')}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const posting = await tx.payrollPosting.findFirst({ where: { id: document.id, tenantId } });
    if (!posting) return;
    const paid = await tx.payrollPaymentAllocation.findFirst({
      where: { tenantId, payrollPeriodId: posting.payrollPeriodId, status: 'PAID' },
    });
    if (paid)
      throw new ValidationAppError('Cannot unpost payroll: payments have already been recorded against this period');
    await tx.payrollPeriod.updateMany({
      where: { id: posting.payrollPeriodId, tenantId },
      data: { status: 'APPROVED', postedAt: null },
    });
  }
}
