import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions(PermissionCodes.AUDIT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.list(tenantId, {
      entityType,
      entityId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
