import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryRecountService } from './inventory-recount.service';
import { InventoryVarianceResolutionService } from './inventory-variance-decision.service';
import { InventoryCountAdjustmentService } from './inventory-count-adjustment.service';
import { InventoryCountReconciliationService } from './inventory-count-reconciliation.service';
import { DecideVarianceDto, RequestInventoryRecountDto, SubmitInventoryRecountDto, VarianceReasonChangeDto, CreateAdjustmentsDto } from './dto/inventory-variance.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-count/sessions/:sessionId')
export class InventoryCountVarianceController {
  constructor(
    private readonly variances: InventoryVarianceService,
    private readonly recounts: InventoryRecountService,
    private readonly decisions: InventoryVarianceResolutionService,
    private readonly adjustments: InventoryCountAdjustmentService,
    private readonly reconciliation: InventoryCountReconciliationService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Post('calculate-variances')
  calculate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string) {
    return this.variances.calculate(tenantId, membershipId, organizationId, user.userId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('variances')
  listVariances(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.variances.list(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('variances/:varianceId')
  getVariance(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string, @Param('varianceId') varianceId: string) {
    return this.variances.get(tenantId, membershipId, organizationId, sessionId, varianceId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_DECIDE_VARIANCE)
  @Post('variances/:varianceId/reason')
  changeReason(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('varianceId') varianceId: string,
    @Body() dto: VarianceReasonChangeDto,
  ) {
    return this.variances.changeReasonCode(tenantId, membershipId, organizationId, user.userId, sessionId, varianceId, dto.reasonCode);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_RECOUNT)
  @Get('recounts')
  listRecounts(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.recounts.list(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_RECOUNT)
  @Post('variances/:varianceId/recounts')
  requestRecount(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('varianceId') varianceId: string,
    @Body() dto: RequestInventoryRecountDto,
  ) {
    return this.recounts.request(tenantId, membershipId, organizationId, user.userId, sessionId, varianceId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_RECOUNT)
  @Post('recounts/:recountId/submit')
  submitRecount(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('recountId') recountId: string,
    @Body() dto: SubmitInventoryRecountDto,
  ) {
    return this.recounts.submit(tenantId, membershipId, organizationId, user.userId, sessionId, recountId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_DECIDE_VARIANCE)
  @Post('variances/:varianceId/decide')
  decide(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('varianceId') varianceId: string,
    @Body() dto: DecideVarianceDto,
  ) {
    return this.decisions.decide(tenantId, membershipId, organizationId, user.userId, sessionId, varianceId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_APPROVE)
  @Post('variances/:varianceId/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('varianceId') varianceId: string,
  ) {
    return this.decisions.approve(tenantId, membershipId, organizationId, user.userId, sessionId, varianceId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_APPROVE)
  @Post('variances/:varianceId/reject')
  reject(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('varianceId') varianceId: string,
    @Body('comment') comment: string,
  ) {
    return this.decisions.reject(tenantId, membershipId, organizationId, user.userId, sessionId, varianceId, comment);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_APPROVE)
  @Post('create-adjustments')
  createAdjustments(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateAdjustmentsDto,
  ) {
    return this.adjustments.createAdjustments(tenantId, membershipId, organizationId, user.userId, sessionId, dto.targets);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_POST_ADJUSTMENTS)
  @Post('post-adjustments')
  postAdjustments(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string) {
    return this.adjustments.postAdjustments(tenantId, membershipId, organizationId, user.userId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_RECONCILE)
  @Get('reconciliation')
  getReconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.reconciliation.get(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_RECONCILE)
  @Post('reconcile')
  reconcile(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string) {
    return this.reconciliation.reconcile(tenantId, membershipId, organizationId, user.userId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_CLOSE)
  @Post('close')
  close(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string) {
    return this.reconciliation.close(tenantId, membershipId, organizationId, user.userId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_CANCEL)
  @Post('cancel')
  cancel(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Body('reason') reason: string,
  ) {
    return this.reconciliation.cancel(tenantId, membershipId, organizationId, user.userId, sessionId, reason);
  }
}
