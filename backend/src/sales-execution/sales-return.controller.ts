import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SalesReturnService } from './sales-return.service';
import { CreateSalesReturnDto, UpdateSalesReturnDto } from './dto/sales-execution.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/sales-returns')
export class SalesReturnController {
  constructor(private readonly returns: SalesReturnService) {}

  @RequirePermissions(PermissionCodes.SALES_RETURN_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.returns.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SALES_RETURN_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.returns.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_RETURN_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateSalesReturnDto,
  ) {
    return this.returns.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SALES_RETURN_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateSalesReturnDto,
  ) {
    return this.returns.update(tenantId, membershipId, organizationId, id, user.userId, dto);
  }
}
