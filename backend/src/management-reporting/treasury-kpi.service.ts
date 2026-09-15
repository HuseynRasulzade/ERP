import { Injectable } from '@nestjs/common';
import { LiquidityForecastService } from '../treasury/liquidity-forecast.service';
import { TreasuryHealthService } from '../treasury/treasury-health.service';

/**
 * TreasuryKPIService (docx spec Phase 24, sections 68-70). A thin
 * Phase-24-shaped wrapper over Phase 14's own `LiquidityForecastService`/
 * `TreasuryHealthService` — those already compute liquidity position,
 * cash-gap alerts, and unreconciled-transaction findings; this never
 * recomputes them (spec section 2's own "duplicate operational truth
 * kimi saxlamamalıdır"). Forecast accuracy (spec section 69, comparing
 * forecast to actual by date/category/counterparty/currency) and
 * liquidity scenarios (spec section 70) are foundation-only in this
 * build — the `ScenarioService` can already model a liquidity-relevant
 * measure, but no dedicated forecast-accuracy comparison table exists
 * yet (disclosed, docs/MANAGEMENT_REPORTING.md section H).
 */
@Injectable()
export class TreasuryKPIService {
  constructor(
    private readonly liquidity: LiquidityForecastService,
    private readonly health: TreasuryHealthService,
  ) {}

  availableLiquidity(tenantId: string, organizationId: string, asOfDate: Date) {
    return this.liquidity.forecastByAccount(tenantId, organizationId, asOfDate);
  }

  cashGap(tenantId: string, organizationId: string, asOfDate: Date) {
    return this.liquidity.cashGapAlerts(tenantId, organizationId, asOfDate);
  }

  async unreconciledTransactions(tenantId: string, organizationId: string) {
    const issues = await this.health.check(tenantId, organizationId);
    return issues.filter((i) => i.code.includes('RECONCIL') || i.code.includes('UNMATCHED'));
  }
}
