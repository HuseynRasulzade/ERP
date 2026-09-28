import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TerminationDocumentService } from './termination-document.service';
import {
  CreateTerminationDocumentDto,
  PostTerminationDocumentDto,
  ReverseTerminationDocumentDto,
} from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/hr/terminations')
export class TerminationDocumentController {
  constructor(private readonly terminations: TerminationDocumentService) {}

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('employmentId') employmentId?: string,
  ) {
    return this.terminations.list(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.terminations.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.HR_TERMINATE_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateTerminationDocumentDto,
  ) {
    return this.terminations.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_TERMINATE_POST)
  @Post(':id/post')
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: PostTerminationDocumentDto,
  ) {
    return this.terminations.post(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_TERMINATE_POST)
  @Post(':id/reverse')
  reverse(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReverseTerminationDocumentDto,
  ) {
    return this.terminations.reverse(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
