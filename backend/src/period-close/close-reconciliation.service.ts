import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { ValidationAppError } from '../common/errors/app-error';

export interface SeedRuleDefinition {
  code: string;
  name: string;
  sourceSystem: string;
  targetMappingKey: string;
  tolerance?: string;
  severity?: string;
  blocking?: boolean;
}

/**
 * Generic reconciliation rule catalog (docx spec Phase 22, section 75 —
 * the "REQUIRED RECONCILIATIONS" minimum list). Each rule's SOURCE amount
 * is computed by `sourceAmountFor` below by querying the owning
 * subledger's own tables directly (never re-deriving a calculation that
 * subledger already owns) and its TARGET amount is the GL account
 * balance resolved through the SAME `AccountingMappingService` key that
 * subledger's own posting handler used, read via
 * `AccountingQueryService`/the immutable AccountingMovement register —
 * so drift here is a genuine posting bug, not a query mismatch.
 */
const DEFAULT_RULES: SeedRuleDefinition[] = [
  { code: 'INVENTORY_VS_GL', name: 'Inventory Cost Layers vs Inventory GL', sourceSystem: 'INVENTORY', targetMappingKey: MappingKeys.MATERIAL_INVENTORY },
  { code: 'AR_VS_GL', name: 'AR Subledger vs AR GL', sourceSystem: 'AR', targetMappingKey: MappingKeys.CUSTOMER_RECEIVABLE },
  { code: 'AP_VS_GL', name: 'AP Subledger vs AP GL', sourceSystem: 'AP', targetMappingKey: MappingKeys.SUPPLIER_PAYABLE },
  { code: 'PAYROLL_VS_GL', name: 'Payroll Liability vs Payroll GL', sourceSystem: 'PAYROLL', targetMappingKey: MappingKeys.EMPLOYEE_NET_PAYABLE },
  { code: 'FA_COST_VS_GL', name: 'Fixed Assets Gross Cost vs FA GL', sourceSystem: 'FIXED_ASSETS', targetMappingKey: MappingKeys.FIXED_ASSET_COST },
  { code: 'ACCUM_DEP_VS_GL', name: 'Accumulated Depreciation vs GL', sourceSystem: 'ACCUMULATED_DEPRECIATION', targetMappingKey: MappingKeys.ACCUMULATED_DEPRECIATION },
  { code: 'PREPAID_VS_GL', name: 'Prepaid Expenses vs Prepaid GL', sourceSystem: 'PREPAID', targetMappingKey: MappingKeys.PREPAID_EXPENSE },
  { code: 'WIP_VS_GL', name: 'WIP Subledger vs WIP GL', sourceSystem: 'WIP', targetMappingKey: MappingKeys.WORK_IN_PROGRESS },
];

@Injectable()
export class CloseReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapping: AccountingMappingService,
  ) {}

  async seedDefaultRules(tenantId: string) {
    for (const rule of DEFAULT_RULES) {
      await this.prisma.reconciliationRule.upsert({
        where: { tenantId_code: { tenantId, code: rule.code } },
        create: { tenantId, code: rule.code, name: rule.name, sourceSystem: rule.sourceSystem, sourceMetric: 'BALANCE', targetMappingKey: rule.targetMappingKey, tolerance: rule.tolerance ?? '0.01', severity: rule.severity ?? 'BLOCKING', blocking: rule.blocking ?? true },
        update: {},
      });
    }
  }

  /** Runs every active rule for the organization as of `asOfDate` and
   * records one `PeriodReconciliationResult` row per rule under
   * `closeRunId` (spec sections 71-75). Never posts a plug entry (spec
   * sections 139-141) — a BLOCKING difference is reported, not fixed. */
  async runAll(tenantId: string, closeRunId: string, organizationId: string, asOfDate: Date) {
    await this.seedDefaultRules(tenantId);
    const rules = await this.prisma.reconciliationRule.findMany({ where: { tenantId, active: true } });
    const results = [];
    for (const rule of rules) {
      const sourceAmount = await this.sourceAmountFor(tenantId, organizationId, rule.sourceSystem, asOfDate);
      // PAYROLL_VS_GL is the one rule whose subledger total (all
      // liability types pooled) spans more than one GL account — sum
      // every payroll-payable mapping key rather than just the net-pay
      // one (see docs/MONTH_CLOSE.md section F).
      const targetKeys = rule.sourceSystem === 'PAYROLL'
        ? [MappingKeys.EMPLOYEE_NET_PAYABLE, MappingKeys.INCOME_TAX_PAYABLE, MappingKeys.SOCIAL_INSURANCE_PAYABLE, MappingKeys.UNEMPLOYMENT_INSURANCE_PAYABLE, MappingKeys.MEDICAL_INSURANCE_PAYABLE, MappingKeys.OTHER_DEDUCTION_PAYABLE]
        : [rule.targetMappingKey];
      let targetAmount = new Decimal(0);
      for (const key of targetKeys) {
        try {
          const account = await this.mapping.resolve(tenantId, organizationId, key, asOfDate);
          targetAmount = targetAmount.plus(await this.accountBalance(tenantId, organizationId, account.id, asOfDate));
        } catch {
          // No mapping configured yet for this tenant — nothing has ever
          // posted to this account, so its GL contribution is legitimately zero.
        }
      }
      const difference = sourceAmount.minus(targetAmount).abs();
      const tolerance = new Decimal(rule.tolerance.toString());
      const status = difference.eq(0) ? 'MATCH' : difference.lte(tolerance) ? 'WITHIN_TOLERANCE' : rule.blocking ? 'BLOCKING' : 'DIFFERENCE';

      const result = await this.prisma.periodReconciliationResult.create({
        data: {
          tenantId,
          closeRunId,
          ruleId: rule.id,
          sourceAmount: sourceAmount.toString(),
          targetAmount: targetAmount.toString(),
          difference: sourceAmount.minus(targetAmount).toString(),
          tolerance: tolerance.toString(),
          status,
          drilldownReference: rule.sourceSystem,
        },
      });
      results.push(result);
    }
    return results;
  }

  /** Direct subledger totals — deliberately queries each module's own
   * tables rather than requiring every module to export a
   * `getSubledgerTotal()` method, since this is read-only aggregation,
   * not a duplicated calculation (see docs/MONTH_CLOSE.md section F). */
  private async sourceAmountFor(tenantId: string, organizationId: string, sourceSystem: string, asOfDate: Date): Promise<Decimal> {
    switch (sourceSystem) {
      case 'INVENTORY': {
        const layers = await this.prisma.inventoryCostLayer.aggregate({ where: { tenantId, organizationId, status: { not: 'REVERSED' }, receiptDate: { lte: asOfDate } }, _sum: { currentRemainingValue: true } });
        return new Decimal((layers._sum.currentRemainingValue ?? 0).toString());
      }
      case 'AR': {
        const ar = await this.prisma.settlementObligation.aggregate({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] } }, _sum: { remainingAmount: true } });
        return new Decimal((ar._sum.remainingAmount ?? 0).toString());
      }
      case 'AP': {
        const ap = await this.prisma.supplierPayable.aggregate({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] } }, _sum: { remainingAmount: true } });
        return new Decimal((ap._sum.remainingAmount ?? 0).toString());
      }
      case 'PAYROLL': {
        const liabilities = await this.prisma.payrollLiability.aggregate({ where: { tenantId, organizationId, status: { notIn: ['PAID', 'WRITTEN_OFF'] } }, _sum: { outstanding: true } });
        return new Decimal((liabilities._sum.outstanding ?? 0).toString());
      }
      case 'FIXED_ASSETS': {
        const assets = await this.prisma.fixedAsset.aggregate({ where: { tenantId, organizationId, status: { notIn: ['DISPOSED', 'WRITTEN_OFF'] } }, _sum: { initialCost: true } });
        return new Decimal((assets._sum.initialCost ?? 0).toString());
      }
      case 'ACCUMULATED_DEPRECIATION': {
        const assets = await this.prisma.fixedAsset.aggregate({ where: { tenantId, organizationId, status: { notIn: ['DISPOSED', 'WRITTEN_OFF'] } }, _sum: { accumulatedDepreciation: true } });
        return new Decimal((assets._sum.accumulatedDepreciation ?? 0).toString());
      }
      case 'PREPAID': {
        const prepaids = await this.prisma.prepaidExpense.aggregate({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] } }, _sum: { remainingAmount: true } });
        return new Decimal((prepaids._sum.remainingAmount ?? 0).toString());
      }
      case 'WIP': {
        const movements = await this.prisma.productionCostMovement.aggregate({ where: { tenantId, organizationId, reversed: false }, _sum: { costIn: true, costOut: true } });
        return new Decimal((movements._sum.costIn ?? 0).toString()).minus(new Decimal((movements._sum.costOut ?? 0).toString()));
      }
      default:
        throw new ValidationAppError(`Unknown reconciliation source system: ${sourceSystem}`);
    }
  }

  private async accountBalance(tenantId: string, organizationId: string, accountId: string, asOfDate: Date): Promise<Decimal> {
    const agg = await this.prisma.accountingMovement.groupBy({
      by: ['side'],
      where: { tenantId, organizationId, accountId, businessDate: { lte: asOfDate } },
      _sum: { amountBase: true },
    });
    const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
    const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
    return debit.minus(credit).abs();
  }

  async resolveIssue(tenantId: string, resultId: string, userId: string, note?: string) {
    return this.prisma.periodReconciliationResult.update({ where: { id: resultId }, data: { status: 'RESOLVED', resolvedBy: userId, resolutionNote: note } });
  }
}
