import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';

const TAX_TYPE_MAPPING: Record<string, { balanceMappingKey: string; sign: 1 | -1 }> = {
  VAT_OUTPUT: { balanceMappingKey: MappingKeys.VAT_OUTPUT_PAYABLE, sign: 1 },
  VAT_INPUT: { balanceMappingKey: MappingKeys.VAT_INPUT_RECOVERABLE, sign: -1 },
};

/**
 * TaxCloseService (docx spec Phase 22, sections 66-70). Reconciles the
 * Tax Register subledger (Phase 5's own `TaxRegisterService`) against the
 * GL VAT accounts it should have posted to — never recomputes a tax rule
 * itself (spec section 197's own "never reimplement"). Only VAT
 * input/output is wired up in this build (payroll statutory liabilities
 * are covered separately by the PAYROLL_VS_GL reconciliation rule;
 * withholding/nondeductible-expense tax adjustments are out of scope —
 * disclosed in docs/MONTH_CLOSE.md section I).
 */
@Injectable()
export class TaxCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxRegister: TaxRegisterService,
    private readonly mapping: AccountingMappingService,
  ) {}

  async run(tenantId: string, closeRunId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const results = [];
    for (const [taxType, config] of Object.entries(TAX_TYPE_MAPPING)) {
      const balance = await this.taxRegister.taxBalance(tenantId, organizationId, { fromDate: periodStart, toDate: periodEnd, taxType });
      const calculatedBalance = new Decimal(balance.taxAmount).mul(config.sign);

      let glBalance = new Decimal(0);
      try {
        const account = await this.mapping.resolve(tenantId, organizationId, config.balanceMappingKey, periodEnd);
        const agg = await this.prisma.accountingMovement.groupBy({ by: ['side'], where: { tenantId, organizationId, accountId: account.id, businessDate: { lte: periodEnd } }, _sum: { amountBase: true } });
        const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
        const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
        glBalance = config.sign === 1 ? credit.minus(debit) : debit.minus(credit);
      } catch {
        // Mapping not configured yet — GL contribution is legitimately zero.
      }

      const difference = calculatedBalance.minus(glBalance);
      const result = await this.prisma.taxPeriodCloseResult.create({
        data: {
          tenantId,
          organizationId,
          closeRunId,
          taxType,
          calculatedBalance: calculatedBalance.toString(),
          glBalance: glBalance.toString(),
          difference: difference.toString(),
          blocking: difference.abs().gt('0.01'),
        },
      });
      results.push(result);
    }
    return results;
  }
}
