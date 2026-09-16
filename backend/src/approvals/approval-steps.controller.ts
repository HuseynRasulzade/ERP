import { Controller, Get, Query } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('approval-steps')
export class ApprovalStepsController {
  constructor(private readonly approvals: ApprovalService) {}

  @RequirePermissions(PermissionCodes.DOCUMENTS_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('documentType') documentType: string, @Query('documentId') documentId: string) {
    return this.approvals.getSteps(tenantId, documentType, documentId);
  }
}
