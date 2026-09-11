import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { OrganizationAccessService } from './organization-access.service';
import {
  CreateOrganizationDto,
  DeactivateOrganizationDto,
  GrantOrganizationAccessDto,
  SetOrganizationDefaultDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { AuditService } from '../audit/audit.service';

@Controller('organizations')
export class OrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions(PermissionCodes.ORGANIZATION_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.organizations.listAccessible(tenantId, membershipId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizations.create(tenantId, membershipId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('id') id: string) {
    return this.organizations.get(tenantId, membershipId, id);
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateOrganizationDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.organizations.update(tenantId, membershipId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: DeactivateOrganizationDto,
  ) {
    return this.organizations.deactivate(tenantId, membershipId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_DEACTIVATE)
  @Post(':id/reactivate')
  reactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: DeactivateOrganizationDto,
  ) {
    return this.organizations.reactivate(tenantId, membershipId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_EDIT)
  @Post(':id/defaults')
  setDefault(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SetOrganizationDefaultDto,
  ) {
    return this.organizations.setDefault(
      tenantId,
      membershipId,
      id,
      user.userId,
      dto.expectedVersion,
      dto.field,
      dto.targetId ?? null,
    );
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_ACCESS_MANAGE)
  @Get(':id/access')
  listAccess(@Param('id') organizationId: string) {
    return this.access.listGrants(organizationId);
  }

  /** The CALLING user's own grant for this organization (department
   * included) — used to auto-fill "my department" on documents like
   * Purchase Requirement. Any member with view access to the organization
   * may read their own grant; this is not an access-management action. */
  @RequirePermissions(PermissionCodes.ORGANIZATION_VIEW)
  @Get(':id/access/mine')
  myAccess(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('id') organizationId: string) {
    return this.access.getOwnGrant(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_ACCESS_MANAGE)
  @Post(':id/access')
  async grantAccess(
    @CurrentTenantId() tenantId: string,
    @Param('id') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: GrantOrganizationAccessDto,
  ) {
    const grant = await this.access.grant(organizationId, dto.membershipId, dto.accessLevel ?? 'FULL', user.userId, dto.departmentId);
    await this.audit.record({
      tenantId,
      eventType: 'ORGANIZATION_ACCESS_GRANTED',
      entityType: 'Organization',
      entityId: organizationId,
      action: 'GRANT',
      userId: user.userId,
      newValues: { membershipId: dto.membershipId, accessLevel: dto.accessLevel ?? 'FULL', departmentId: dto.departmentId },
    });
    return grant;
  }

  @RequirePermissions(PermissionCodes.ORGANIZATION_ACCESS_MANAGE)
  @Post(':id/access/:membershipId/revoke')
  async revokeAccess(
    @CurrentTenantId() tenantId: string,
    @Param('id') organizationId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.access.revoke(organizationId, membershipId);
    await this.audit.record({
      tenantId,
      eventType: 'ORGANIZATION_ACCESS_REVOKED',
      entityType: 'Organization',
      entityId: organizationId,
      action: 'REVOKE',
      userId: user.userId,
      oldValues: { membershipId },
    });
    return { success: true };
  }
}
