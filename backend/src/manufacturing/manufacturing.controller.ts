import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { BOMService } from './bom.service';
import { RoutingService } from './routing.service';
import { WorkCenterService } from './work-center.service';
import { ProductionOrderService } from './production-order.service';
import { PRODUCTION_ORDER_TYPE } from './production-order.repository';
import { MaterialIssueService } from './material-issue.service';
import { MATERIAL_ISSUE_TYPE } from './material-issue.repository';
import { OperationExecutionService } from './operation-execution.service';
import { ProductionOutputService } from './production-output.service';
import { PRODUCTION_OUTPUT_RECEIPT_TYPE } from './production-output.repository';
import { OverheadService } from './overhead.service';
import { ProductionCloseService } from './production-close.service';
import { ProductionReportingService } from './production-reporting.service';
import { ProductionHealthService } from './production-health.service';
import {
  CreateBOMDto,
  CreateBOMVersionDto,
  CreateWorkCenterDto,
  CreateRoutingDto,
  CreateRoutingVersionDto,
  CreateProductionOrderDto,
  CreateMaterialIssueDto,
  RecordExecutionDto,
  RecordLaborDto,
  RecordMachineTimeDto,
  RecordScrapDto,
  CreateOutputReceiptDto,
  CreateOverheadPoolDto,
  CloseProductionOrderDto,
} from './dto/manufacturing.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Manufacturing / Production API (docx spec Phase 21). See docs/MANUFACTURING.md. */
@Controller('organizations/:organizationId/manufacturing')
export class ManufacturingController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly bom: BOMService,
    private readonly routing: RoutingService,
    private readonly workCenters: WorkCenterService,
    private readonly orders: ProductionOrderService,
    private readonly materialIssues: MaterialIssueService,
    private readonly execution: OperationExecutionService,
    private readonly outputs: ProductionOutputService,
    private readonly overhead: OverheadService,
    private readonly close: ProductionCloseService,
    private readonly reporting: ProductionReportingService,
    private readonly health: ProductionHealthService,
    private readonly posting: DocumentPostingService,
  ) {}

  // --- Engineering: BOM / Routing / Work Centers ---
  @RequirePermissions(PermissionCodes.PRODUCTION_ENGINEERING_EDIT)
  @Post('boms')
  createBom(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateBOMDto) {
    return this.bom.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_ENGINEERING_EDIT)
  @Post('boms/:id/versions')
  createBomVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateBOMVersionDto) {
    return this.bom.createVersion(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_ENGINEERING_EDIT)
  @Post('bom-versions/:versionId/approve')
  approveBomVersion(@CurrentTenantId() tenantId: string, @Param('versionId') versionId: string, @CurrentUser() user: { userId: string }) {
    return this.bom.approveVersion(tenantId, user.userId, versionId);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('boms')
  listBoms(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.bom.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('boms/:id')
  getBom(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.bom.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_ENGINEERING_EDIT)
  @Post('work-centers')
  createWorkCenter(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateWorkCenterDto) {
    return this.workCenters.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('work-centers')
  listWorkCenters(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.workCenters.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_ENGINEERING_EDIT)
  @Post('routings')
  createRouting(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateRoutingDto) {
    return this.routing.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_ENGINEERING_EDIT)
  @Post('routings/:id/versions')
  createRoutingVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateRoutingVersionDto) {
    return this.routing.createVersion(tenantId, user.userId, id, dto);
  }

  // --- Production orders ---
  @RequirePermissions(PermissionCodes.PRODUCTION_ORDER_CREATE)
  @Post('orders')
  createOrder(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateProductionOrderDto) {
    return this.orders.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_ORDER_RELEASE)
  @Post('orders/:id/release')
  releaseOrder(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, PRODUCTION_ORDER_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('orders')
  listOrders(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('status') status?: string) {
    return this.orders.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('orders/:id/material-availability')
  materialAvailability(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.orders.materialAvailability(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('orders/:id/wip')
  wipRollForward(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reporting.wipRollForward(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('orders/:id/actual-cost')
  actualCost(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reporting.actualCostSummary(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VARIANCE_VIEW)
  @Post('orders/:id/calculate-variances')
  calculateVariances(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.close.calculateVariances(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('orders/:id/close-checks')
  async closeChecks(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.close.runCloseChecks(tenantId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_ORDER_CLOSE)
  @Post('orders/:id/close')
  closeOrder(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CloseProductionOrderDto) {
    return this.close.close(tenantId, membershipId, organizationId, user.userId, id, dto.force);
  }

  // --- Material issue ---
  @RequirePermissions(PermissionCodes.PRODUCTION_MATERIAL_ISSUE)
  @Post('material-issues')
  createMaterialIssue(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateMaterialIssueDto) {
    return this.materialIssues.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_MATERIAL_ISSUE)
  @Post('material-issues/:id/post')
  postMaterialIssue(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, MATERIAL_ISSUE_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('material-issues')
  listMaterialIssues(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('productionOrderId') productionOrderId?: string) {
    return this.materialIssues.list(tenantId, membershipId, organizationId, productionOrderId);
  }

  // --- Execution / labor / machine / scrap ---
  @RequirePermissions(PermissionCodes.PRODUCTION_EXECUTION_RECORD)
  @Post('operation-executions')
  recordExecution(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordExecutionDto) {
    return this.execution.recordExecution(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_EXECUTION_RECORD)
  @Post('labor-inputs')
  recordLabor(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordLaborDto) {
    return this.execution.recordLabor(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_EXECUTION_RECORD)
  @Post('machine-time-inputs')
  recordMachineTime(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordMachineTimeDto) {
    return this.execution.recordMachineTime(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_EXECUTION_RECORD)
  @Post('scrap-records')
  recordScrap(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordScrapDto) {
    return this.execution.recordScrap(tenantId, membershipId, organizationId, user.userId, dto);
  }

  // --- Output receipt ---
  @RequirePermissions(PermissionCodes.PRODUCTION_OUTPUT_RECEIVE)
  @Post('output-receipts')
  createOutputReceipt(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateOutputReceiptDto) {
    return this.outputs.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_OUTPUT_RECEIVE)
  @Post('output-receipts/:id/post')
  postOutputReceipt(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, PRODUCTION_OUTPUT_RECEIPT_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('output-receipts')
  listOutputReceipts(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('productionOrderId') productionOrderId?: string) {
    return this.outputs.list(tenantId, membershipId, organizationId, productionOrderId);
  }

  // --- Overhead ---
  @RequirePermissions(PermissionCodes.PRODUCTION_OVERHEAD_MANAGE)
  @Post('overhead-pools')
  createOverheadPool(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateOverheadPoolDto) {
    return this.overhead.createPool(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_OVERHEAD_MANAGE)
  @Post('overhead-pools/:id/allocate')
  allocateOverhead(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.overhead.allocate(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('overhead-pools')
  listOverheadPools(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.overhead.list(tenantId, organizationId);
  }

  // --- Health ---
  @RequirePermissions(PermissionCodes.PRODUCTION_VIEW)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }
}
