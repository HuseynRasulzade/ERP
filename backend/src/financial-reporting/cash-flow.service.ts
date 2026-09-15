import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FinancialResultService } from '../period-close/financial-result.service';

/**
 * CashFlowService (docx spec Phase 23, sections 39-51). Both methods are
 * implemented (spec section 39's "Recommended enterprise foundation:
 * both"):
 *
 * DIRECT — sums real posted `BankCashMovement`/`CashMovement` rows
 * (spec section 40), classified into OPERATING/INVESTING/FINANCING via
 * `CashFlowMappingRule` matched on `sourceDocumentType`. Any rule with
 * `isInternalTransfer: true` (Bank↔Bank, Cash↔Bank) is EXCLUDED from the
 * external flow entirely (spec sections 44-45) — never presented as an
 * inflow AND outflow that cancel out, simply never counted.
 *
 * INDIRECT — starts from Phase 22's own `FinancialResultService` net
 * profit and adds back depreciation (from `FixedAssetMovement`) plus the
 * period's AR/Inventory/AP deltas (working-capital movements, spec
 * section 48) read from the same GL-mapped accounts the Balance Sheet
 * itself uses — never a separate parallel calculation.
 */
@Injectable()
export class CashFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapping: AccountingMappingService,
    private readonly financialResult: FinancialResultService,
  ) {}

  async directMethod(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const rules = await this.prisma.cashFlowMappingRule.findMany({ where: { tenantId, effectiveFrom: { lte: periodEnd }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodEnd } }] }, include: { cashFlowCategory: true } });
    const ruleByOperationType = new Map(rules.filter((r) => r.sourceOperationType).map((r) => [r.sourceOperationType!, r]));

    const [bankMovements, cashMovements] = await Promise.all([
      this.prisma.bankCashMovement.findMany({ where: { tenantId, organizationId, effectiveDate: { gte: periodStart, lte: periodEnd }, reversed: false } }),
      this.prisma.cashMovement.findMany({ where: { tenantId, organizationId, effectiveDate: { gte: periodStart, lte: periodEnd }, reversed: false } }),
    ]);

    const categoryTotals = new Map<string, { classification: string; name: string; amount: Decimal }>();
    let externalNet = new Decimal(0);
    let excludedInternal = new Decimal(0);

    for (const movement of [...bankMovements, ...cashMovements]) {
      const rule = ruleByOperationType.get(movement.sourceDocumentType);
      const signed = new Decimal(movement.baseAmount.toString()).mul(movement.direction === 'INFLOW' ? 1 : -1);
      if (rule?.isInternalTransfer) {
        excludedInternal = excludedInternal.plus(signed);
        continue; // spec sections 44-45 — never appears as external flow
      }
      externalNet = externalNet.plus(signed);
      const categoryKey = rule?.cashFlowCategory.code ?? 'UNCLASSIFIED';
      const entry = categoryTotals.get(categoryKey) ?? { classification: rule?.cashFlowCategory.classification ?? 'OPERATING', name: rule?.cashFlowCategory.name ?? 'Unclassified', amount: new Decimal(0) };
      entry.amount = entry.amount.plus(signed);
      categoryTotals.set(categoryKey, entry);
    }

    const openingCash = await this.cashPosition(tenantId, organizationId, new Date(periodStart.getTime() - 86400000));
    const closingCash = await this.cashPosition(tenantId, organizationId, periodEnd);

    return {
      categories: Array.from(categoryTotals.entries()).map(([code, v]) => ({ code, name: v.name, classification: v.classification, amount: v.amount.toFixed(2) })),
      openingCash: openingCash.toFixed(2),
      netCashFlow: externalNet.toFixed(2),
      closingCash: closingCash.toFixed(2),
      excludedInternalTransferAmount: excludedInternal.toFixed(2),
      reconciles: openingCash.plus(externalNet).minus(closingCash).abs().lte('0.01'), // spec section 46
    };
  }

  async indirectMethod(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const netProfit = new Decimal((await this.financialResult.calculate(tenantId, organizationId, periodStart, periodEnd)).netResult);

    const depreciation = await this.periodMovementSum(tenantId, organizationId, MappingKeys.DEPRECIATION_EXPENSE, periodStart, periodEnd);
    const unrealizedFx = await this.prisma.fXRevaluationItem.aggregate({ where: { tenantId, run: { organizationId, closingRateDate: { gte: periodStart, lte: periodEnd } } }, _sum: { unrealizedGainLoss: true } });
    const fxAdjustment = new Decimal((unrealizedFx._sum.unrealizedGainLoss ?? 0).toString()).neg(); // add back — non-cash

    const arDelta = await this.balanceDelta(tenantId, organizationId, MappingKeys.CUSTOMER_RECEIVABLE, periodStart, periodEnd);
    const inventoryDelta = await this.balanceDelta(tenantId, organizationId, MappingKeys.MATERIAL_INVENTORY, periodStart, periodEnd);
    const apDelta = await this.balanceDelta(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, periodStart, periodEnd);

    // AR/Inventory increase consumes cash; AP increase provides cash.
    const workingCapitalAdjustment = arDelta.neg().plus(inventoryDelta.neg()).plus(apDelta);
    const operatingCashFlow = netProfit.plus(depreciation).plus(fxAdjustment).plus(workingCapitalAdjustment);

    return {
      netProfit: netProfit.toFixed(2),
      depreciation: depreciation.toFixed(2),
      unrealizedFxAdjustment: fxAdjustment.toFixed(2),
      workingCapitalAdjustment: workingCapitalAdjustment.toFixed(2),
      operatingCashFlow: operatingCashFlow.toFixed(2),
      // Investing/Financing sections reuse the direct method's own
      // categorization — indirect only restates the Operating section
      // (spec section 47's own scope), never re-derives investing/
      // financing from balance changes.
    };
  }

  private async cashPosition(tenantId: string, organizationId: string, asOfDate: Date): Promise<Decimal> {
    let total = new Decimal(0);
    for (const key of [MappingKeys.CASH, MappingKeys.BANK]) {
      try {
        const account = await this.mapping.resolve(tenantId, organizationId, key, asOfDate);
        const agg = await this.prisma.accountingMovement.groupBy({ by: ['side'], where: { tenantId, organizationId, accountId: account.id, businessDate: { lte: asOfDate } }, _sum: { amountBase: true } });
        const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
        const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
        total = total.plus(debit.minus(credit));
      } catch {
        // Mapping not configured — contributes zero.
      }
    }
    return total;
  }

  private async periodMovementSum(tenantId: string, organizationId: string, mappingKey: string, periodStart: Date, periodEnd: Date): Promise<Decimal> {
    try {
      const account = await this.mapping.resolve(tenantId, organizationId, mappingKey, periodEnd);
      const agg = await this.prisma.accountingMovement.groupBy({ by: ['side'], where: { tenantId, organizationId, accountId: account.id, businessDate: { gte: periodStart, lte: periodEnd } }, _sum: { amountBase: true } });
      const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
      const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
      return debit.minus(credit);
    } catch {
      return new Decimal(0);
    }
  }

  private async balanceDelta(tenantId: string, organizationId: string, mappingKey: string, periodStart: Date, periodEnd: Date): Promise<Decimal> {
    try {
      const account = await this.mapping.resolve(tenantId, organizationId, mappingKey, periodEnd);
      const opening = await this.balanceAsOf(tenantId, organizationId, account.id, new Date(periodStart.getTime() - 86400000));
      const closing = await this.balanceAsOf(tenantId, organizationId, account.id, periodEnd);
      return closing.minus(opening);
    } catch {
      return new Decimal(0);
    }
  }

  private async balanceAsOf(tenantId: string, organizationId: string, accountId: string, asOfDate: Date): Promise<Decimal> {
    const agg = await this.prisma.accountingMovement.groupBy({ by: ['side'], where: { tenantId, organizationId, accountId, businessDate: { lte: asOfDate } }, _sum: { amountBase: true } });
    const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
    const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
    return debit.minus(credit);
  }
}
