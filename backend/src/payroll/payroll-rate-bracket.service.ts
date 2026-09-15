import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * PayrollRateBracketService — the ONE place every jurisdiction-specific
 * number in this engine lives (spec sections 3, 27, 30, 37, 51, 131):
 * progressive tax bands, contribution rates, overtime/night/holiday
 * multipliers, the leave-pay averaging divisor, minimum wage. No
 * calculation service in this module ever hardcodes a rate or a divisor
 * — they all call `resolveFlat`/`resolveProgressive` here. `seedAzerbaijan2026`
 * loads the 2026 non-oil-private example figures quoted in the spec
 * (sections 51, 55, 57-58) as ordinary seed DATA, never as an `if
 * (country === 'AZ')` branch in the engine itself.
 */
@Injectable()
export class PayrollRateBracketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { bracketType: string; payerType?: string; regime?: string; sequence?: number; thresholdFrom?: number; thresholdTo?: number; fixedComponent?: number; percentage?: number; flatValue?: number; legalReference?: string; effectiveFrom: string }) {
    const row = await this.prisma.payrollRateBracket.create({
      data: {
        tenantId,
        bracketType: dto.bracketType,
        payerType: dto.payerType,
        regime: dto.regime ?? 'DEFAULT',
        sequence: dto.sequence ?? 1,
        thresholdFrom: (dto.thresholdFrom ?? 0).toString(),
        thresholdTo: dto.thresholdTo?.toString(),
        fixedComponent: (dto.fixedComponent ?? 0).toString(),
        percentage: (dto.percentage ?? 0).toString(),
        flatValue: dto.flatValue?.toString(),
        legalReference: dto.legalReference,
        effectiveFrom: new Date(dto.effectiveFrom),
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_RATE_BRACKET_CREATED', entityType: 'PAYROLL_RATE_BRACKET', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  /** All bands of a progressive/tiered bracket set effective on `date`
   * (spec section 53's own `TaxBracket`/section 56's `ContributionBracket`
   * unified into one model here — see docs/PAYROLL.md). */
  async resolveBands(tenantId: string, bracketType: string, regime: string, date: Date, payerType?: string) {
    const bands = await this.prisma.payrollRateBracket.findMany({
      where: { tenantId, bracketType, regime, payerType: payerType ?? undefined, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      orderBy: { sequence: 'asc' },
    });
    return bands;
  }

  /** A single non-progressive value (spec's own `AVERAGE_PAY_DIVISOR`,
   * `OVERTIME_MULTIPLIER`, `MINIMUM_WAGE`) — the most recent band whose
   * window covers `date`. */
  async resolveFlat(tenantId: string, bracketType: string, regime: string, date: Date, payerType?: string): Promise<Decimal | null> {
    const bands = await this.resolveBands(tenantId, bracketType, regime, date, payerType);
    if (bands.length === 0) return null;
    const band = bands[0];
    return band.flatValue != null ? new Decimal(band.flatValue.toString()) : new Decimal(band.percentage.toString());
  }

  /** Applies a full progressive/tiered band set to `base` (spec section
   * 53's own generic progressive engine — used for INCOME_TAX and for
   * bracketed contribution rates alike). */
  async applyProgressive(tenantId: string, bracketType: string, regime: string, date: Date, base: Decimal, payerType?: string): Promise<{ amount: Decimal; trace: string; legalReference: string | null }> {
    const bands = await this.resolveBands(tenantId, bracketType, regime, date, payerType);
    if (bands.length === 0) throw new ValidationAppError(`No ${bracketType} rate bracket configured for regime ${regime} as of ${date.toISOString().slice(0, 10)} — missing legal rule (spec section 128 MISSING_LEGAL_RULE).`);

    let amount = new Decimal(0);
    const traceParts: string[] = [];
    for (const band of bands) {
      const from = new Decimal(band.thresholdFrom.toString());
      const to = band.thresholdTo != null ? new Decimal(band.thresholdTo.toString()) : null;
      if (base.lte(from)) continue;
      const bandBase = Decimal.min(base, to ?? base).minus(from);
      if (bandBase.lte(0)) continue;
      const bandAmount = bandBase.mul(band.percentage.toString()).plus(band.fixedComponent.toString());
      amount = amount.plus(bandAmount);
      traceParts.push(`[${from.toString()}-${to?.toString() ?? '∞'}]: ${bandBase.toString()} × ${band.percentage.toString()} + ${band.fixedComponent.toString()} = ${bandAmount.toString()}`);
    }
    return { amount, trace: traceParts.join('; '), legalReference: bands[0]?.legalReference ?? null };
  }

  list(tenantId: string, bracketType?: string) {
    return this.prisma.payrollRateBracket.findMany({ where: { tenantId, bracketType, status: 'ACTIVE' }, orderBy: [{ bracketType: 'asc' }, { sequence: 'asc' }] });
  }

  /** Seeds the 2026 non-oil, non-government sector figures quoted in the
   * spec (sections 51, 55, 57-58) — a starting point for a tenant to
   * adjust, never assumed correct for every organization/year without
   * review. */
  async seedAzerbaijan2026(tenantId: string, userId: string) {
    const regime = 'AZ_NON_OIL_PRIVATE_2026';
    const effectiveFrom = '2026-01-01';
    const rows: Parameters<PayrollRateBracketService['create']>[2][] = [
      // Income tax — 3% up to 2,500 / 10% marginal 2,500-8,000 / 14% above 8,000 (spec section 51)
      { bracketType: 'INCOME_TAX', regime, sequence: 1, thresholdFrom: 0, thresholdTo: 2500, percentage: 0.03, legalReference: 'DVX 2026 non-oil private income tax schedule', effectiveFrom },
      { bracketType: 'INCOME_TAX', regime, sequence: 2, thresholdFrom: 2500, thresholdTo: 8000, percentage: 0.1, legalReference: 'DVX 2026 non-oil private income tax schedule', effectiveFrom },
      { bracketType: 'INCOME_TAX', regime, sequence: 3, thresholdFrom: 8000, percentage: 0.14, legalReference: 'DVX 2026 non-oil private income tax schedule', effectiveFrom },
      // Social insurance — employee/employer split at the 200 and 8,000 thresholds (spec section 55)
      { bracketType: 'SOCIAL_INSURANCE', payerType: 'EMPLOYEE', regime, sequence: 1, thresholdFrom: 0, thresholdTo: 200, percentage: 0.03, legalReference: 'AZ Social Insurance Law 2026', effectiveFrom },
      { bracketType: 'SOCIAL_INSURANCE', payerType: 'EMPLOYEE', regime, sequence: 2, thresholdFrom: 200, percentage: 0.1, legalReference: 'AZ Social Insurance Law 2026', effectiveFrom },
      { bracketType: 'SOCIAL_INSURANCE', payerType: 'EMPLOYER', regime, sequence: 1, thresholdFrom: 0, thresholdTo: 200, percentage: 0.22, legalReference: 'AZ Social Insurance Law 2026', effectiveFrom },
      { bracketType: 'SOCIAL_INSURANCE', payerType: 'EMPLOYER', regime, sequence: 2, thresholdFrom: 200, thresholdTo: 8000, percentage: 0.15, legalReference: 'AZ Social Insurance Law 2026', effectiveFrom },
      { bracketType: 'SOCIAL_INSURANCE', payerType: 'EMPLOYER', regime, sequence: 3, thresholdFrom: 8000, percentage: 0.1, legalReference: 'AZ Social Insurance Law 2026', effectiveFrom },
      // Unemployment insurance — 0.5% each side (spec section 57)
      { bracketType: 'UNEMPLOYMENT_INSURANCE', payerType: 'EMPLOYEE', regime, sequence: 1, thresholdFrom: 0, percentage: 0.005, legalReference: 'DVX 2026', effectiveFrom },
      { bracketType: 'UNEMPLOYMENT_INSURANCE', payerType: 'EMPLOYER', regime, sequence: 1, thresholdFrom: 0, percentage: 0.005, legalReference: 'DVX 2026', effectiveFrom },
      // Medical insurance — illustrative 2,500 threshold split (spec section 58) — tenant must confirm current rates before relying on this
      { bracketType: 'MEDICAL_INSURANCE', payerType: 'EMPLOYEE', regime, sequence: 1, thresholdFrom: 0, thresholdTo: 2500, percentage: 0.02, legalReference: 'Mandatory Medical Insurance Law 2026 (verify current rate)', effectiveFrom },
      { bracketType: 'MEDICAL_INSURANCE', payerType: 'EMPLOYEE', regime, sequence: 2, thresholdFrom: 2500, percentage: 0.04, legalReference: 'Mandatory Medical Insurance Law 2026 (verify current rate)', effectiveFrom },
      { bracketType: 'MEDICAL_INSURANCE', payerType: 'EMPLOYER', regime, sequence: 1, thresholdFrom: 0, thresholdTo: 2500, percentage: 0.02, legalReference: 'Mandatory Medical Insurance Law 2026 (verify current rate)', effectiveFrom },
      { bracketType: 'MEDICAL_INSURANCE', payerType: 'EMPLOYER', regime, sequence: 2, thresholdFrom: 2500, percentage: 0.04, legalReference: 'Mandatory Medical Insurance Law 2026 (verify current rate)', effectiveFrom },
      // Non-payer-split constants
      { bracketType: 'OVERTIME_MULTIPLIER', regime, sequence: 1, thresholdFrom: 0, flatValue: 2, legalReference: 'Labor Code Art. 165 statutory minimum', effectiveFrom },
      { bracketType: 'AVERAGE_PAY_DIVISOR', regime, sequence: 1, thresholdFrom: 0, flatValue: 30.4, legalReference: 'Labor Code Art. 140', effectiveFrom },
    ];
    const created = [];
    for (const r of rows) created.push(await this.create(tenantId, userId, r as any));
    return created;
  }
}
