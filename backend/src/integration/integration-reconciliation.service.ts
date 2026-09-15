import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

export interface ReconciliationSide {
  key: string;
  count: number;
  amount: Decimal;
}

/**
 * IntegrationReconciliationService (docx spec Phase 28, sections 101-
 * 106, 221). "Message delivered" is never treated as "business
 * reconciled" (spec section 106) — this service is the ONLY place that
 * makes that claim, and only after actually comparing external vs
 * internal totals keyed by `matchingKeys`. Both sides are supplied by
 * the caller (a bank/marketplace/tax connector's own read of the
 * external total, and the ERP-side total computed by that same domain
 * module's own query service) — this generic engine never assumes how
 * either side is computed, consistent with Phase 22's own
 * `CloseReconciliationService` precedent (compare subledger totals
 * resolved by each owning module, never guess).
 */
@Injectable()
export class IntegrationReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  createRule(tenantId: string, input: { endpointId: string; code: string; sourceMetric: string; targetMetric: string; matchingKeys: string[]; tolerance?: Decimal }) {
    return this.prisma.integrationReconciliationRule.create({
      data: { tenantId, endpointId: input.endpointId, code: input.code, sourceMetric: input.sourceMetric, targetMetric: input.targetMetric, matchingKeys: input.matchingKeys as object, tolerance: (input.tolerance ?? new Decimal(0)).toString() },
    });
  }

  async run(tenantId: string, ruleId: string, periodLabel: string, externalSide: ReconciliationSide[], internalSide: ReconciliationSide[], userId?: string) {
    const rule = await this.prisma.integrationReconciliationRule.findFirst({ where: { id: ruleId, tenantId } });
    if (!rule) throw new NotFoundAppError('IntegrationReconciliationRule', ruleId);

    const externalByKey = new Map(externalSide.map((s) => [s.key, s]));
    const internalByKey = new Map(internalSide.map((s) => [s.key, s]));
    const allKeys = new Set([...externalByKey.keys(), ...internalByKey.keys()]);
    const tolerance = new Decimal(rule.tolerance.toString());

    let matched = 0;
    let missingInternal = 0;
    let missingExternal = 0;
    let amountMismatchTotal = new Decimal(0);
    const resultRows: { matchKey: string; resultType: string; externalValue?: unknown; internalValue?: unknown; difference?: string }[] = [];

    for (const key of allKeys) {
      const ext = externalByKey.get(key);
      const int = internalByKey.get(key);
      if (ext && !int) {
        missingInternal++;
        resultRows.push({ matchKey: key, resultType: 'INTERNAL_MISSING', externalValue: { count: ext.count, amount: ext.amount.toString() } });
        continue;
      }
      if (int && !ext) {
        missingExternal++;
        resultRows.push({ matchKey: key, resultType: 'EXTERNAL_MISSING', internalValue: { count: int.count, amount: int.amount.toString() } });
        continue;
      }
      const diff = ext!.amount.minus(int!.amount).abs();
      if (diff.gt(tolerance) || ext!.count !== int!.count) {
        amountMismatchTotal = amountMismatchTotal.plus(diff);
        resultRows.push({ matchKey: key, resultType: 'AMOUNT_MISMATCH', externalValue: { count: ext!.count, amount: ext!.amount.toString() }, internalValue: { count: int!.count, amount: int!.amount.toString() }, difference: diff.toString() });
      } else {
        matched++;
        resultRows.push({ matchKey: key, resultType: 'MATCH' });
      }
    }

    return this.prisma.runInTransaction(async (tx) => {
      const run = await tx.integrationReconciliationRun.create({
        data: { tenantId, ruleId, periodLabel, recordsCompared: allKeys.size, matched, missingInternal, missingExternal, amountMismatch: amountMismatchTotal.toString(), status: 'COMPLETED' },
      });
      await tx.integrationReconciliationResult.createMany({
        data: resultRows.map((r) => ({ tenantId, runId: run.id, matchKey: r.matchKey, resultType: r.resultType, externalValue: (r.externalValue ?? null) as object | undefined, internalValue: (r.internalValue ?? null) as object | undefined, difference: r.difference })),
      });
      await this.audit.record({ tenantId, eventType: 'ReconciliationCompleted', eventCategory: 'INTEGRATION', entityType: 'IntegrationReconciliationRun', entityId: run.id, operation: 'CREATE', action: 'CREATE', userId: userId ?? null, metadata: { ruleCode: rule.code, periodLabel, matched, missingInternal, missingExternal, amountMismatch: amountMismatchTotal.toString() } }, tx);
      return { run, results: resultRows };
    });
  }
}
