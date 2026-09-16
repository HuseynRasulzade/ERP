import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PurchaseRequirementService } from './purchase-requirement.service';
import { ProcurementPlanningService } from './procurement-planning.service';
import { CreatePurchaseRequirementDto, CreatePurchaseOrderFromRequirementDto, UpdatePurchaseRequirementDto } from './dto/procurement.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { ApprovalDecisionDto } from '../approvals/dto/approval-decision.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * PurchaseRequirement controller (spec sections 98-99). `create-order` is
 * a bespoke allocation command rather than the generic CreateBasedOn
 * mapper (see ProcurementPlanningService docstring): it needs a supplier
 * and per-line quantities the generic 1:1 mapper interface has no room
 * to accept.
 */
@Controller('organizations/:organizationId/purchase-requirements')
export class PurchaseRequirementController {
  constructor(
    private readonly requirements: PurchaseRequirementService,
    private readonly planning: ProcurementPlanningService,
  ) {}

  @RequirePermissions(PermissionCodes.PURCHASE_REQUIREMENT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    return this.requirements.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_REQUIREMENT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.requirements.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_REQUIREMENT_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePurchaseRequirementDto,
  ) {
    return this.requirements.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_REQUIREMENT_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdatePurchaseRequirementDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.requirements.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_REQUIREMENT_CANCEL)
  @Post(':id/cancel')
  cancel(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.requirements.cancel(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_REQUIREMENT_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.requirements.approve(tenantId, membershipId, organizationId, id, user.userId, dto.comment);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_REQUIREMENT_REJECT)
  @Post(':id/reject')
  reject(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.requirements.reject(tenantId, membershipId, organizationId, id, user.userId, dto.comment);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_CREATE)
  @Post(':id/create-order')
  createOrder(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePurchaseOrderFromRequirementDto,
  ) {
    return this.planning.createPurchaseOrderFromRequirement(tenantId, membershipId, organizationId, id, user.userId, dto);
  }
}
