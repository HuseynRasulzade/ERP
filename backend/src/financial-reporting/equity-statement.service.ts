import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';

/**
 * EquityStatementService (docx spec Phase 23, sections 52-55). Rolls
 * forward each `EquityComponent` from its opening balance through
 * period movements to closing — `Opening + Movements = Closing` (spec
 * section 55) — reading the SAME `AccountingMovement` register every
 * other statement reads, keyed by each component's own mapped GL
 * account (via `EquityComponent.accountMappingKey` ->
 * `AccountingMappingService`).
 */
@Injectable()
export class EquityStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapping: AccountingMappingService,
  ) {}

  async createComponent(tenantId: string, dto: { code: string; name: string; componentType: string; accountMappingKey?: string }) {
    return this.prisma.equityComponent.create({ data: { tenantId, code: dto.code, name: dto.name, componentType: dto.componentType, accountMappingKey: dto.accountMappingKey } });
  }

  async run(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const components = await this.prisma.equityComponent.findMany({ where: { tenantId } });
    const rows = [];
    let openingTotal = new Decimal(0);
    let closingTotal = new Decimal(0);

    for (const component of components) {
      if (!component.accountMappingKey) {
        rows.push({ code: component.code, name: component.name, opening: '0', movement: '0', closing: '0', unmapped: true });
        continue;
      }
      let opening = new Decimal(0);
      let movement = new Decimal(0);
      try {
        const account = await this.mapping.resolve(tenantId, organizationId, component.accountMappingKey, periodEnd);
        opening = await this.netBalance(tenantId, organizationId, account.id, { lt: periodStart });
        movement = await this.netBalance(tenantId, organizationId, account.id, { gte: periodStart, lte: periodEnd });
      } catch {
        // No mapping configured for this component yet — zero contribution.
      }
      const closing = opening.plus(movement);
      openingTotal = openingTotal.plus(opening);
      closingTotal = closingTotal.plus(closing);
      rows.push({ code: component.code, name: component.name, componentType: component.componentType, opening: opening.toFixed(2), movement: movement.toFixed(2), closing: closing.toFixed(2), unmapped: false });
    }

    return { rows, openingEquity: openingTotal.toFixed(2), closingEquity: closingTotal.toFixed(2), netMovement: closingTotal.minus(openingTotal).toFixed(2) };
  }

  private async netBalance(tenantId: string, organizationId: string, accountId: string, businessDate: Record<string, Date>): Promise<Decimal> {
    const agg = await this.prisma.accountingMovement.groupBy({ by: ['side'], where: { tenantId, organizationId, accountId, businessDate }, _sum: { amountBase: true } });
    const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
    const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
    return credit.minus(debit); // equity accounts normally carry a CREDIT balance
  }
}
