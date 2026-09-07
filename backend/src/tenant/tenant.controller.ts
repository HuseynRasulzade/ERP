import { Body, Controller, Get, Post } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/tenant.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenantContext } from '../common/decorators/skip-tenant-context.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('tenants')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @SkipTenantContext()
  @Post()
  create(@CurrentUser() user: { userId: string }, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(user.userId, dto);
  }

  @Get('current')
  getCurrent(@CurrentTenantId() tenantId: string) {
    return this.tenants.get(tenantId);
  }

  @RequirePermissions(PermissionCodes.CORE_USERS_VIEW)
  @Get('members')
  listMembers(@CurrentTenantId() tenantId: string) {
    return this.tenants.listMembers(tenantId);
  }

  // Organization CRUD lives in OrgStructureModule (Phase 1) — see
  // GET/POST /organizations. Phase 0's minimal placeholder was superseded
  // once Phase 1 added the full entity, effective defaults, and
  // organization-scoped access grants.
}
