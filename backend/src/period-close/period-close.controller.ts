import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { FinancialPeriodService } from './financial-period.service';
import { PeriodClosePolicyService } from './period-close-policy.service';
import { PeriodReadinessService } from './period-readiness.service';
import { PeriodCloseOrchestrator } from './period-close-orchestrator.service';
import { CloseIssueService } from './close-issue.service';
import { CloseReconciliationService } from './close-reconciliation.service';
import { AccrualService } from './accrual.service';
import { DeferredRevenueService } from './deferred-revenue.service';
import { PeriodLockService } from './period-lock.service';
import { PeriodReopenService } from './period-reopen.service';
import { CloseHealthService } from './close-health.service';
import { CloseReportingService } from './close-reporting.service';
import {
  CreateFinancialPeriodDto,
  UpsertClosePolicyDto,
  StartCloseRunDto,
  ResolveIssueDto,
  WaiveIssueDto,
  CreateAccrualDto,
  PostAccrualDto,
  MatchAccrualDto,
  CreateDeferredRevenueDto,
  ReopenRequestDto,
} from './dto/period-close.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Financial Period Close Orchestrator API (docx spec Phase 22). See
 * docs/MONTH_CLOSE.md. Endpoints follow spec section 165's conceptual
 * list, nested under the organization the way every other module's
 * controller in this codebase already is. */
@Controller('organizations/:organizationId/period-close')
export class PeriodCloseController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly financialPeriod: FinancialPeriodService,
    private readonly policy: PeriodClosePolicyService,
    private readonly readiness: PeriodReadinessService,
    private readonly orchestrator: PeriodCloseOrchestrator,
    private readonly issues: CloseIssueService,
    private readonly reconciliation: CloseReconciliationService,
    private readonly accruals: AccrualService,
    private readonly deferredRevenue: DeferredRevenueService,
    private readonly lock: PeriodLockService,
    private readonly reopen: PeriodReopenService,
    private readonly health: CloseHealthService,
    private readonly reporting: CloseReportingService,
  ) {}

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_VIEW)
  @Get('periods')
  listPeriods(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.financialPeriod.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_RUN)
  @Post('periods')
  createPeriod(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFinancialPeriodDto) {
    return this.financialPeriod.create(tenantId, membershipId, user.userId, { organizationId, ...dto });
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_VIEW)
  @Get('periods/:id/readiness')
  async readinessCheck(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    const period = await this.financialPeriod.get(tenantId, id);
    return this.readiness.checkReadiness(tenantId, organizationId, period.periodStart, period.periodEnd);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_PREVIEW)
  @Post('periods/:id/preview')
  preview(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.orchestrator.start(tenantId, user.userId, id, 'PREVIEW');
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_RUN)
  @Post('periods/:id/start')
  start(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: StartCloseRunDto) {
    return this.orchestrator.start(tenantId, user.userId, id, dto.closeType as never);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_VIEW)
  @Get('runs/:id')
  getRun(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.orchestrator.getRun(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_VIEW)
  @Get('runs/:id/steps')
  async getSteps(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.checklist(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_STEP_RUN)
  @Post('runs/:id/steps/:step/retry')
  retryStep(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Param('step') step: string, @CurrentUser() user: { userId: string }) {
    return this.orchestrator.retryStep(tenantId, user.userId, id, step);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_VIEW)
  @Get('runs/:id/issues')
  getIssues(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.issues.list(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_RESOLVE_ISSUE)
  @Post('issues/:id/resolve')
  resolveIssue(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ResolveIssueDto) {
    return this.issues.resolve(tenantId, user.userId, id, dto.note);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_WAIVE_WARNING)
  @Post('issues/:id/waive')
  waiveIssue(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: WaiveIssueDto) {
    return this.issues.waive(tenantId, user.userId, id, dto.reason);
  }

  @RequirePermissions(PermissionCodes.PERIOD_VIEW_RECONCILIATION)
  @Get('runs/:id/reconciliations')
  getReconciliations(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.reconciliationSummary(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PERIOD_SOFT_CLOSE)
  @Post('periods/:id/soft-close')
  softClose(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.lock.softClose(tenantId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.PERIOD_HARD_CLOSE)
  @Post('periods/:id/hard-close')
  hardClose(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.lock.hardClose(tenantId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.PERIOD_REOPEN_REQUEST)
  @Post('periods/:id/reopen-request')
  reopenRequest(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: Omit<ReopenRequestDto, 'financialPeriodId'>) {
    return this.reopen.request(tenantId, user.userId, { financialPeriodId: id, ...dto });
  }

  @RequirePermissions(PermissionCodes.PERIOD_REOPEN_APPROVE)
  @Post('reopen-requests/:id/approve')
  approveReopen(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.reopen.approve(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.PERIOD_RECLOSE)
  @Post('periods/:id/reclose')
  reclose(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.orchestrator.start(tenantId, user.userId, id, 'RECLOSE');
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_VIEW)
  @Get('health')
  getHealth(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.health.check(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_MANUAL_ADJUSTMENT)
  @Post('accruals')
  createAccrual(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: Omit<CreateAccrualDto, 'organizationId'>) {
    return this.accruals.create(tenantId, user.userId, { organizationId, ...dto });
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_MANUAL_ADJUSTMENT)
  @Post('accruals/:id/post')
  postAccrual(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: PostAccrualDto) {
    return this.accruals.post(tenantId, user.userId, id, new Date(dto.businessDate));
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_MANUAL_ADJUSTMENT)
  @Post('accruals/:id/match')
  matchAccrual(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: MatchAccrualDto) {
    return this.accruals.matchActual(tenantId, user.userId, id, dto.actualDocumentType, dto.actualDocumentId, dto.actualAmount);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_VIEW)
  @Get('accruals')
  listAccruals(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('financialPeriodId') financialPeriodId?: string) {
    return this.accruals.list(tenantId, organizationId, financialPeriodId);
  }

  @RequirePermissions(PermissionCodes.PERIOD_CLOSE_MANUAL_ADJUSTMENT)
  @Post('deferred-revenue')
  createDeferredRevenue(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: Omit<CreateDeferredRevenueDto, 'organizationId'>) {
    return this.deferredRevenue.create(tenantId, user.userId, { organizationId, ...dto });
  }

  @RequirePermissions(PermissionCodes.PERIOD_VIEW_RECONCILIATION)
  @Get('reconciliation-rules/:resultId/resolve')
  resolveReconciliation(@CurrentTenantId() tenantId: string, @Param('resultId') resultId: string, @CurrentUser() user: { userId: string }) {
    return this.reconciliation.resolveIssue(tenantId, resultId, user.userId);
  }
}
