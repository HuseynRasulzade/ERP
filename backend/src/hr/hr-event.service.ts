import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ErrorCode, HrRuleError } from '../common/errors/app-error';
import { HrEventType } from './hr.constants';
import { fmtHr, isoHr, todayHr } from './hr-date.util';

export interface HrEventInput {
  tenantId: string;
  eventType: string;
  employeeId?: string | null;
  employmentId?: string | null;
  organizationId?: string | null;
  effectiveDate: Date;
  oldState?: unknown;
  newState?: unknown;
  extra?: Record<string, unknown>;
  sourceDocumentType?: string | null;
  sourceDocumentId?: string | null;
  /** Distinguishes several events of the same type from one source. */
  keySuffix?: string;
}

/**
 * Contract a downstream module (Phase 18 Work Time, Phase 19 Payroll, ...)
 * implements and registers so HR Core can (a) detect that a backdated HR
 * change invalidates already-derived data and (b) refuse a change that would
 * rewrite a FINALIZED payroll/time period (spec 122-124). Phase 17 ships no
 * provider — the registry is the extension point.
 */
export interface HrDownstreamDependencyProvider {
  readonly name: string;
  /** True when this consumer already derived data for the employment on or
   * after `fromDate` (e.g. a generated timesheet or payroll calculation). */
  hasDerivedData(tenantId: string, employmentId: string, fromDate: Date): Promise<boolean>;
  /** True when a period covering `date` is finalized for this employment
   * (e.g. final settlement paid) — HR changes effective then are blocked. */
  isFinalized(tenantId: string, employmentId: string, date: Date): Promise<boolean>;
}

/**
 * Reliable HR outbox (spec 119-121) + backdated-change recalculation signal
 * (spec 122-124). Events are written in the SAME transaction as the HR
 * change they describe; `(tenantId, idempotencyKey)` is unique and inserts
 * use ON CONFLICT DO NOTHING, so a retried post never produces a duplicate
 * event and consumers never see a duplicate record.
 */
@Injectable()
export class HrEventService {
  private readonly logger = new Logger('HrEventService');
  private readonly providers: HrDownstreamDependencyProvider[] = [];

  constructor(private readonly prisma: PrismaService) {}

  registerDownstreamProvider(provider: HrDownstreamDependencyProvider) {
    const existing = this.providers.findIndex((p) => p.name === provider.name);
    if (existing >= 0) this.providers.splice(existing, 1);
    this.providers.push(provider);
  }

  unregisterDownstreamProvider(name: string) {
    const existing = this.providers.findIndex((p) => p.name === name);
    if (existing >= 0) this.providers.splice(existing, 1);
  }

  async emit(tx: PrismaTransactionClient, input: HrEventInput) {
    const idempotencyKey = `${input.eventType}:${input.sourceDocumentType ?? '-'}:${input.sourceDocumentId ?? '-'}${input.keySuffix ? `:${input.keySuffix}` : ''}`;
    await tx.hrEvent.createMany({
      data: [
        {
          tenantId: input.tenantId,
          eventType: input.eventType,
          employeeId: input.employeeId ?? null,
          employmentId: input.employmentId ?? null,
          organizationId: input.organizationId ?? null,
          effectiveDate: input.effectiveDate,
          payload: {
            employee_id: input.employeeId ?? null,
            employment_id: input.employmentId ?? null,
            organization_id: input.organizationId ?? null,
            effective_date: isoHr(input.effectiveDate),
            old_state: (input.oldState ?? null) as any,
            new_state: (input.newState ?? null) as any,
            source_document: input.sourceDocumentType ? { type: input.sourceDocumentType, id: input.sourceDocumentId } : null,
            ...(input.extra ?? {}),
          } as any,
          sourceDocumentType: input.sourceDocumentType ?? null,
          sourceDocumentId: input.sourceDocumentId ?? null,
          idempotencyKey,
        },
      ],
      skipDuplicates: true,
    });
  }

  /** Blocks a change effective inside a period a downstream consumer has
   * finalized (spec 49/124 — e.g. payroll final settlement already paid). */
  async assertNotFinalized(tenantId: string, employmentId: string, date: Date) {
    for (const provider of this.providers) {
      if (await provider.isFinalized(tenantId, employmentId, date)) {
        throw new HrRuleError(
          ErrorCode.HR_DOWNSTREAM_DEPENDENCY,
          `HR change effective ${fmtHr(date)} is blocked: ${provider.name} has a finalized period for this employment — reopen it in ${provider.name} first`,
          409,
        );
      }
    }
  }

  /**
   * Emits HR_RECALCULATION_REQUIRED when the change is backdated (effective
   * before today) or any downstream consumer already derived data from the
   * effective date on (spec 122/123/139). Never silently accepted.
   */
  async signalRecalculationIfNeeded(
    tx: PrismaTransactionClient,
    input: Omit<HrEventInput, 'eventType' | 'oldState' | 'newState'> & { employmentId: string; changeType: string },
  ) {
    const reasons: string[] = [];
    if (input.effectiveDate < todayHr()) reasons.push('BACKDATED');
    const consumers: string[] = [];
    for (const provider of this.providers) {
      try {
        if (await provider.hasDerivedData(input.tenantId, input.employmentId, input.effectiveDate)) consumers.push(provider.name);
      } catch (e) {
        this.logger.warn(`Downstream provider ${provider.name} failed: ${(e as Error).message}`);
        consumers.push(provider.name);
      }
    }
    if (consumers.length) reasons.push('DOWNSTREAM_DATA_EXISTS');
    if (!reasons.length) return false;
    await this.emit(tx, {
      ...input,
      eventType: HrEventType.HR_RECALCULATION_REQUIRED,
      keySuffix: input.keySuffix ?? input.changeType,
      extra: {
        change_type: input.changeType,
        affected_from: isoHr(input.effectiveDate),
        reasons,
        affected_consumers: consumers.length ? consumers : ['WORK_TIME', 'PAYROLL', 'COST_ALLOCATION'],
      },
    });
    return true;
  }

  list(tenantId: string, filter: { status?: string; eventType?: string; employmentId?: string; employeeId?: string; limit?: number }) {
    return this.prisma.hrEvent.findMany({
      where: {
        tenantId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.eventType ? { eventType: filter.eventType } : {}),
        ...(filter.employmentId ? { employmentId: filter.employmentId } : {}),
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(filter.limit ?? 200, 1000),
    });
  }

  /** Consumer acknowledgement — idempotent (re-acking is a no-op). */
  async acknowledge(tenantId: string, ids: string[]) {
    const res = await this.prisma.hrEvent.updateMany({ where: { tenantId, id: { in: ids }, status: 'PENDING' }, data: { status: 'DISPATCHED', dispatchedAt: new Date() } });
    return { acknowledged: res.count };
  }
}
