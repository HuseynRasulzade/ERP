import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowInstanceService } from './workflow-instance.service';
import { ApprovalDecisionService } from './approval-decision.service';
import { DelegationService } from './delegation.service';
import { WorkflowCancellationService } from './workflow-cancellation.service';
import { WorkflowSimulationService } from './workflow-simulation.service';
import { WorkflowExecutionGateService } from './workflow-execution-gate.service';
import { WorkflowReportingService } from './workflow-reporting.service';
import { WorkflowHealthService } from './workflow-health.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDefinitionDto,
  CreateVersionDto,
  AddStepDto,
  CreateApproverRuleDto,
  StartWorkflowDto,
  DecideDto,
  CancelDto,
  RestartDto,
  CreateDelegationDto,
  SimulateDto,
  ExecutionGateDto,
} from './dto/workflow.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Workflow / Approval / Execution-Gate Engine API (docx spec Phase 26).
 * See docs/WORKFLOW_ENGINE.md. */
@Controller('workflows')
export class WorkflowController {
  constructor(
    private readonly definitions: WorkflowDefinitionService,
    private readonly instances: WorkflowInstanceService,
    private readonly decisions: ApprovalDecisionService,
    private readonly delegation: DelegationService,
    private readonly cancellation: WorkflowCancellationService,
    private readonly simulation: WorkflowSimulationService,
    private readonly executionGate: WorkflowExecutionGateService,
    private readonly reporting: WorkflowReportingService,
    private readonly health: WorkflowHealthService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermissions(PermissionCodes.WORKFLOW_DEFINITION_VIEW)
  @Get('definitions')
  listDefinitions(@CurrentTenantId() tenantId: string) {
    return this.prisma.workflowDefinition.findMany({ where: { tenantId }, include: { versions: true } });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_DEFINITION_EDIT)
  @Post('definitions')
  createDefinition(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateDefinitionDto) {
    return this.definitions.createDefinition(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_DEFINITION_EDIT)
  @Post('definitions/:id/versions')
  createVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateVersionDto) {
    return this.definitions.createVersion(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_DEFINITION_EDIT)
  @Post('versions/:id/steps')
  addStep(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Body() dto: AddStepDto) {
    return this.definitions.addStep(tenantId, id, dto as never);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_DEFINITION_APPROVE)
  @Post('versions/:id/activate')
  activateVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.definitions.activateVersion(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_ADMIN)
  @Post('approver-rules')
  createApproverRule(@CurrentTenantId() tenantId: string, @Body() dto: CreateApproverRuleDto) {
    return this.prisma.approverRule.create({ data: { tenantId, ...dto } });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_DEFINITION_EDIT)
  @Post('definitions/:code/simulate')
  simulate(@CurrentTenantId() tenantId: string, @Param('code') code: string, @Body() dto: SimulateDto) {
    return this.simulation.simulate(tenantId, code, dto.organizationId, dto.context);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_APPROVE)
  @Post('instances')
  start(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: StartWorkflowDto) {
    return this.instances.start(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_VIEW)
  @Get('instances/:id')
  getInstance(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.instances.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_VIEW_OWN)
  @Get('inbox')
  inbox(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }) {
    return this.prisma.approverAssignment.findMany({ where: { tenantId, userId: user.userId, status: 'PENDING' }, include: { stepInstance: { include: { instance: true, definition: true } } }, orderBy: { responseDeadline: 'asc' } });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_APPROVE)
  @Post('instances/:id/approve')
  approve(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: DecideDto) {
    return this.decisions.decide(tenantId, user.userId, { workflowInstanceId: id, decision: 'APPROVE', ...dto });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_REJECT)
  @Post('instances/:id/reject')
  reject(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: DecideDto) {
    return this.decisions.decide(tenantId, user.userId, { workflowInstanceId: id, decision: 'REJECT', ...dto });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_REQUEST_CHANGE)
  @Post('instances/:id/request-change')
  requestChange(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: DecideDto) {
    return this.decisions.decide(tenantId, user.userId, { workflowInstanceId: id, decision: 'REQUEST_CHANGE', ...dto });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_DELEGATE)
  @Post('delegations')
  createDelegation(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateDelegationDto) {
    return this.delegation.create(tenantId, { delegatorUserId: user.userId, ...dto });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_CANCEL)
  @Post('instances/:id/cancel')
  cancel(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CancelDto) {
    return this.cancellation.cancel(tenantId, user.userId, id, dto.reason);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_RESTART)
  @Post('instances/:id/restart')
  restart(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: RestartDto) {
    return this.cancellation.restart(tenantId, user.userId, id, dto.newSnapshot, dto.newBusinessVersion, dto.context);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_VIEW)
  @Get('instances/:id/timeline')
  timeline(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.prisma.approvalDecision.findMany({ where: { tenantId, workflowInstanceId: id }, orderBy: { decidedAt: 'asc' } });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_ADMIN)
  @Post('execution-gate/check')
  checkExecutionGate(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: ExecutionGateDto) {
    return this.executionGate.assertExecutionAllowed(tenantId, { ...dto, executorUserId: user.userId });
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_VIEW)
  @Get('reports/sla')
  slaReport(@CurrentTenantId() tenantId: string, @Query('workflowDefinitionId') workflowDefinitionId?: string) {
    return this.reporting.slaMetrics(tenantId, workflowDefinitionId);
  }

  @RequirePermissions(PermissionCodes.WORKFLOW_VIEW)
  @Get('health')
  getHealth(@CurrentTenantId() tenantId: string) {
    return this.health.check(tenantId);
  }
}
