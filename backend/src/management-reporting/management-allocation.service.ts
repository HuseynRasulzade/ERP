import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * ManagementAllocationService (docx spec Phase 24, sections 49-53).
 * Management-only allocation of a cost pool across a target dimension's
 * members, driven by a governed measure (revenue, units, headcount,
 * ...) — NEVER posts to GL (spec sections 50, 215's own critical rule).
 * Every allocated line is traceable: Source pool -> Rule -> Driver ->
 * Target -> Amount (spec section 53).
 */
@Injectable()
export class ManagementAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createRule(tenantId: string, dto: { code: string; name: string; sourceMeasure: string; targetDimension: string; driverMeasure: string; scenario?: string }) {
    return this.prisma.managementAllocationRule.create({ data: { tenantId, code: dto.code, name: dto.name, sourceMeasure: dto.sourceMeasure, targetDimension: dto.targetDimension, driverMeasure: dto.driverMeasure, scenario: dto.scenario ?? 'ACTUAL', ruleVersion: 1 } });
  }

  /** Runs the rule for `period`, allocating `poolAmount` across every
   * target-dimension member with a nonzero driver value, proportional
   * to its share of total driver value (spec section 52's own driver
   * examples). Idempotent per (rule, organization, period) — a retry
   * replaces the prior run's lines rather than duplicating them (spec
   * section 148). */
  /** `targetKeys` driver values are caller-supplied — typically each
   * pre-computed via `ManagementMeasureService.evaluate` for the same
   * dimension/period (e.g. each customer's own NET_REVENUE) rather than
   * re-derived inside this generic engine, which only knows how to
   * SPLIT a pool by a already-known share, not which measure a given
   * rule's `driverMeasure` code should resolve to for an arbitrary
   * dimension. */
  async run(tenantId: string, userId: string, ruleCode: string, organizationId: string, period: string, poolAmount: Decimal.Value, targetKeys: { key: string; driverValue: Decimal.Value }[]) {
    const rule = await this.prisma.managementAllocationRule.findFirst({ where: { tenantId, code: ruleCode }, orderBy: { ruleVersion: 'desc' } });
    if (!rule) throw new NotFoundAppError('ManagementAllocationRule', ruleCode);

    const pool = new Decimal(poolAmount);
    const totalDriver = targetKeys.reduce((s, t) => s.plus(new Decimal(t.driverValue)), new Decimal(0));
    if (totalDriver.lte(0)) throw new ValidationAppError(`Cannot allocate ${ruleCode} for ${period} — total driver value is zero or negative.`);

    const existing = await this.prisma.managementAllocationRun.findUnique({ where: { tenantId_ruleId_organizationId_period: { tenantId, ruleId: rule.id, organizationId, period } } });
    const run = existing
      ? await this.prisma.managementAllocationRun.update({ where: { id: existing.id }, data: { poolAmount: pool.toString(), runBy: userId } })
      : await this.prisma.managementAllocationRun.create({ data: { tenantId, ruleId: rule.id, organizationId, period, poolAmount: pool.toString(), runBy: userId } });
    await this.prisma.managementAllocationLine.deleteMany({ where: { tenantId, runId: run.id } });

    const lines = [];
    for (const target of targetKeys) {
      const driverValue = new Decimal(target.driverValue);
      const share = driverValue.div(totalDriver);
      const allocatedAmount = pool.mul(share);
      lines.push(await this.prisma.managementAllocationLine.create({ data: { tenantId, runId: run.id, targetKey: target.key, driverValue: driverValue.toString(), driverShare: share.toString(), allocatedAmount: allocatedAmount.toString() } }));
    }

    await this.audit.record({ tenantId, eventType: 'MGMT_ALLOCATION_RUN_COMPLETED', entityType: 'ManagementAllocationRun', entityId: run.id, action: existing ? 'UPDATE' : 'CREATE', userId, newValues: { ruleCode, period, poolAmount: pool.toString(), targetCount: lines.length } });
    return { run, lines };
  }

  async getRunLines(tenantId: string, organizationId: string, ruleCode: string, period: string) {
    const rule = await this.prisma.managementAllocationRule.findFirst({ where: { tenantId, code: ruleCode }, orderBy: { ruleVersion: 'desc' } });
    if (!rule) return [];
    const run = await this.prisma.managementAllocationRun.findUnique({ where: { tenantId_ruleId_organizationId_period: { tenantId, ruleId: rule.id, organizationId, period } }, include: { lines: true } });
    return run?.lines ?? [];
  }
}
