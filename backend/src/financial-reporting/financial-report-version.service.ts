import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FinancialStatementDefinitionService } from './financial-statement-definition.service';
import { FinancialReportingFrameworkService } from './financial-reporting-framework.service';
import { BalanceSheetService } from './balance-sheet.service';
import { ProfitLossService } from './profit-loss.service';
import { TrialBalanceReportingService } from './trial-balance-reporting.service';
import { FinancialReportValidationService, ValidationOutcome } from './financial-report-validation.service';

/**
 * FinancialReportVersionService (docx spec Phase 23, sections 61-67,
 * 112-120). Owns the `FinancialReportRun` lifecycle
 * (CREATED→CALCULATING→CALCULATED→REVIEWED→APPROVED→FINAL→SIGNED, plus
 * SUPERSEDED) and is the ONLY place that writes `FinancialReportCell`
 * rows — a FINAL/SIGNED run's cells are then immutable (spec section
 * 66/119): `recalculate` refuses to touch a run whose status is FINAL or
 * SIGNED, and correcting one always means `restate`, which creates a
 * brand-new run referencing the old one, never an in-place edit (spec
 * sections 60, 113).
 */
@Injectable()
export class FinancialReportVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly statementDefinitions: FinancialStatementDefinitionService,
    private readonly frameworks: FinancialReportingFrameworkService,
    private readonly balanceSheet: BalanceSheetService,
    private readonly profitLoss: ProfitLossService,
    private readonly trialBalance: TrialBalanceReportingService,
    private readonly validation: FinancialReportValidationService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: { organizationId: string; statementDefinitionCode: string; frameworkCode: string; reportingCurrencyId: string; runType: string; asOfDate?: string; periodStart?: string; periodEnd?: string; financialPeriodId?: string; closeRunId?: string },
  ) {
    const definition = await this.prisma.financialStatementDefinition.findFirstOrThrow({ where: { tenantId, code: dto.statementDefinitionCode } });
    const framework = await this.prisma.financialReportingFramework.findFirstOrThrow({ where: { tenantId, code: dto.frameworkCode } });
    const referenceDate = dto.asOfDate ? new Date(dto.asOfDate) : new Date(dto.periodEnd!);
    const statementVersion = await this.statementDefinitions.resolveActiveVersion(tenantId, definition.id, referenceDate);
    const frameworkVersion = await this.frameworks.resolveActiveVersion(tenantId, framework.id, referenceDate);

    // A closed period requires CLOSED_PERIOD/FINAL run types; an open
    // period may only ever produce a PREVIEW (spec sections 114, 181).
    if (dto.financialPeriodId && (dto.runType === 'FINAL' || dto.runType === 'CLOSED_PERIOD')) {
      const period = await this.prisma.financialPeriod.findUniqueOrThrow({ where: { id: dto.financialPeriodId } });
      if (period.status !== 'HARD_CLOSED') throw new ValidationAppError(`Final financial report requires the period to be HARD_CLOSED (currently ${period.status}) — a PREVIEW is available instead (spec section 181).`);
    }

    const run = await this.prisma.financialReportRun.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        statementDefinitionId: definition.id,
        statementVersionId: statementVersion.id,
        frameworkVersionId: frameworkVersion.id,
        financialPeriodId: dto.financialPeriodId,
        closeRunId: dto.closeRunId,
        asOfDate: dto.asOfDate ? new Date(dto.asOfDate) : undefined,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        reportingCurrencyId: dto.reportingCurrencyId,
        runType: dto.runType,
        status: 'CREATED',
        generatedBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORT_RUN_CREATED', entityType: 'FinancialReportRun', entityId: run.id, action: 'CREATE', userId, newValues: { statementType: definition.statementType, runType: dto.runType } });
    return this.calculate(tenantId, userId, run.id);
  }

  async calculate(tenantId: string, userId: string, runId: string) {
    const run = await this.get(tenantId, runId);
    if (run.status === 'FINAL' || run.status === 'SIGNED') throw new ValidationAppError('Cannot recalculate a FINAL/SIGNED report run — restate instead (spec section 119).');

    await this.prisma.financialReportRun.update({ where: { id: run.id }, data: { status: 'CALCULATING' } });
    const definition = await this.prisma.financialStatementDefinition.findUniqueOrThrow({ where: { id: run.statementDefinitionId } });

    let rowsOut: { rowCode: string; amount: string | null; sourceCount: number }[] = [];
    const validations: ValidationOutcome[] = [];

    if (definition.statementType === 'BALANCE_SHEET') {
      const result = await this.balanceSheet.run(tenantId, run.organizationId, run.statementVersionId, run.asOfDate!);
      rowsOut = result.rows;
      const bsValidation = await this.validation.validateBalanceSheet(result.equationDifference);
      validations.push(bsValidation);
    } else if (definition.statementType === 'PROFIT_AND_LOSS') {
      const result = await this.profitLoss.run(tenantId, run.organizationId, run.statementVersionId, run.periodStart!, run.periodEnd!);
      rowsOut = result.rows;
      validations.push(await this.validation.validatePnlAgainstCloseResult(result.netResult, tenantId, run.organizationId, run.closeRunId ?? undefined));
    } else if (definition.statementType === 'TRIAL_BALANCE') {
      const membershipId = await this.resolveMembership(tenantId, userId, run.organizationId);
      const result = await this.trialBalance.run(tenantId, membershipId, run.organizationId, run.periodStart!, run.periodEnd!);
      rowsOut = result.rows.map((r) => ({ rowCode: r.code, amount: r.closingDebit !== '0.00' ? r.closingDebit : `-${r.closingCredit}`, sourceCount: 0 }));
      validations.push(await this.validation.validateTrialBalance({ closingDebit: result.totals.closingDebit, closingCredit: result.totals.closingCredit }));
    }

    await this.prisma.financialReportCell.deleteMany({ where: { tenantId, reportRunId: run.id } });
    for (const row of rowsOut) {
      if (row.amount === null) continue;
      await this.prisma.financialReportCell.create({ data: { tenantId, reportRunId: run.id, rowCode: row.rowCode, columnCode: 'CURRENT', amount: row.amount, currencyId: run.reportingCurrencyId, sourceCount: row.sourceCount } });
    }
    for (const outcome of validations) await this.validation.persist(tenantId, run.id, outcome);

    const blocking = validations.some((v) => v.status === 'BLOCKING' || v.status === 'FAIL');
    const status = blocking ? 'VALIDATION_ERROR' : validations.some((v) => v.status === 'WARNING') ? 'VALIDATION_WARNING' : 'CALCULATED';
    return this.prisma.financialReportRun.update({ where: { id: run.id }, data: { status }, include: { cells: true, validationResults: true } });
  }

  async review(tenantId: string, userId: string, runId: string) {
    const run = await this.assertStatus(tenantId, runId, ['CALCULATED', 'VALIDATION_WARNING']);
    const updated = await this.prisma.financialReportRun.update({ where: { id: run.id }, data: { status: 'REVIEWED', reviewedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORT_REVIEWED', entityType: 'FinancialReportRun', entityId: run.id, action: 'UPDATE', userId });
    return updated;
  }

  async approve(tenantId: string, userId: string, runId: string) {
    const run = await this.assertStatus(tenantId, runId, ['REVIEWED']);
    const updated = await this.prisma.financialReportRun.update({ where: { id: run.id }, data: { status: 'APPROVED', approvedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORT_APPROVED', entityType: 'FinancialReportRun', entityId: run.id, action: 'UPDATE', userId });
    return updated;
  }

  /** Finalization requires close status, no blocking validations, and
   * an approved mapping/layout state (spec section 116). Idempotent —
   * calling finalize again on an already-FINAL run just returns it
   * (spec section 150). */
  async finalize(tenantId: string, userId: string, runId: string) {
    const run = await this.get(tenantId, runId);
    if (run.status === 'FINAL' || run.status === 'SIGNED') return run;
    if (run.status !== 'APPROVED') throw new ValidationAppError(`Cannot finalize from status ${run.status}`);
    const blockingValidations = await this.prisma.financialReportValidationResult.count({ where: { tenantId, reportRunId: run.id, status: { in: ['FAIL', 'BLOCKING'] } } });
    if (blockingValidations > 0) throw new ValidationAppError(`Cannot finalize — ${blockingValidations} blocking validation(s) unresolved.`);

    const updated = await this.prisma.financialReportRun.update({ where: { id: run.id }, data: { status: 'FINAL', finalizedBy: userId, finalizedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORT_FINALIZED', entityType: 'FinancialReportRun', entityId: run.id, action: 'UPDATE', userId });
    return updated;
  }

  /** Idempotent — a repeated sign request on an already-signed run
   * returns the existing signature rather than creating a duplicate
   * (spec section 150). */
  async sign(tenantId: string, userId: string, runId: string, dto: { signerRole?: string; signatureType?: string }) {
    const run = await this.assertStatus(tenantId, runId, ['FINAL', 'SIGNED']);
    const existing = await this.prisma.financialReportSignature.findFirst({ where: { tenantId, reportRunId: run.id, signerUserId: userId, status: 'ACTIVE' } });
    if (existing) return existing;

    const cells = await this.prisma.financialReportCell.findMany({ where: { tenantId, reportRunId: run.id }, orderBy: { rowCode: 'asc' } });
    const reportHash = createHash('sha256').update(cells.map((c) => `${c.rowCode}|${c.columnCode}|${c.amount.toString()}`).join('\n')).digest('hex');

    const signature = await this.prisma.financialReportSignature.create({ data: { tenantId, reportRunId: run.id, signerUserId: userId, signerRole: dto.signerRole, signatureType: dto.signatureType ?? 'INTERNAL_APPROVAL', reportHash, status: 'ACTIVE' } });
    await this.prisma.financialReportRun.update({ where: { id: run.id }, data: { status: 'SIGNED' } });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORT_SIGNED', entityType: 'FinancialReportRun', entityId: run.id, action: 'UPDATE', userId, newValues: { reportHash } });
    return signature;
  }

  /** Restatement (spec sections 60, 113, 183) — the ORIGINAL run is
   * never deleted or edited; it is marked SUPERSEDED and a brand-new run
   * is created (typically against a Phase 22 reclose's v2 close run). */
  async restate(tenantId: string, userId: string, runId: string, reason: string, newCloseRunId?: string) {
    if (!reason) throw new ValidationAppError('Restatement requires an explicit reason (spec section 60)');
    const original = await this.get(tenantId, runId);

    const restated = await this.prisma.financialReportRun.create({
      data: {
        tenantId,
        organizationId: original.organizationId,
        statementDefinitionId: original.statementDefinitionId,
        statementVersionId: original.statementVersionId,
        frameworkVersionId: original.frameworkVersionId,
        financialPeriodId: original.financialPeriodId,
        closeRunId: newCloseRunId ?? original.closeRunId,
        asOfDate: original.asOfDate,
        periodStart: original.periodStart,
        periodEnd: original.periodEnd,
        reportingCurrencyId: original.reportingCurrencyId,
        runType: 'RESTATED',
        status: 'CREATED',
        calculationVersion: original.calculationVersion + 1,
        supersedesRunId: original.id,
        restatementReason: reason,
        generatedBy: userId,
      },
    });
    await this.prisma.financialReportRun.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORT_SUPERSEDED', entityType: 'FinancialReportRun', entityId: original.id, action: 'UPDATE', userId, reason });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORT_RESTATED', entityType: 'FinancialReportRun', entityId: restated.id, action: 'CREATE', userId, reason, newValues: { supersedesRunId: original.id } });
    return this.calculate(tenantId, userId, restated.id);
  }

  /** Called by Phase 22's own `PeriodReopenService` (or triggered
   * manually) when the underlying close is reclosed — marks every
   * report run built off the superseded close run SUPERSEDED without
   * deleting them (spec section 112). */
  async supersedeByCloseRun(tenantId: string, userId: string, oldCloseRunId: string) {
    const runs = await this.prisma.financialReportRun.findMany({ where: { tenantId, closeRunId: oldCloseRunId, status: { in: ['FINAL', 'SIGNED'] } } });
    for (const run of runs) {
      await this.prisma.financialReportRun.update({ where: { id: run.id }, data: { status: 'SUPERSEDED' } });
      await this.audit.record({ tenantId, eventType: 'FIN_REPORT_SUPERSEDED', entityType: 'FinancialReportRun', entityId: run.id, action: 'UPDATE', userId, reason: 'Underlying close was reclosed' });
    }
    return runs.length;
  }

  async get(tenantId: string, id: string) {
    const run = await this.prisma.financialReportRun.findFirst({ where: { id, tenantId }, include: { cells: true, validationResults: { include: { rule: true } } } });
    if (!run) throw new NotFoundAppError('FinancialReportRun', id);
    return run;
  }

  /** Resolves a membership with access to `organizationId` to satisfy
   * `AccountingQueryService`'s own `OrganizationAccessService.assertAccess`
   * call — same "orchestration principal" pattern as Phase 22's
   * `PeriodCloseStepExecutor.systemMembership` (docs/MONTH_CLOSE.md
   * section M), reused here rather than duplicated (docs/
   * FINANCIAL_REPORTING.md section D). */
  private async resolveMembership(tenantId: string, userId: string, organizationId: string): Promise<string> {
    const ownMembership = await this.prisma.tenantMembership.findFirst({ where: { tenantId, userId, status: 'ACTIVE' } });
    if (ownMembership) {
      const access = await this.prisma.organizationAccess.findFirst({ where: { tenantMembershipId: ownMembership.id, organizationId } });
      if (access) return ownMembership.id;
    }
    const anyAccess = await this.prisma.organizationAccess.findFirst({ where: { organizationId, membership: { tenantId, status: 'ACTIVE' } } });
    if (anyAccess) return anyAccess.tenantMembershipId;
    if (ownMembership) return ownMembership.id;
    throw new NotFoundAppError('OrganizationAccess', `for organization ${organizationId}`);
  }

  private async assertStatus(tenantId: string, id: string, allowed: string[]) {
    const run = await this.get(tenantId, id);
    if (!allowed.includes(run.status)) throw new ValidationAppError(`FinancialReportRun ${id} is ${run.status}; expected one of ${allowed.join(', ')}`);
    return run;
  }
}
