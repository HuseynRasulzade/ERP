import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TaxRuleAdminService } from './tax-rule-admin.service';
import { CreateTaxRuleDto, RepealTaxRuleDto, UpdateTaxRuleDto } from './dto/tax-engine.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Custom TaxRule admin workflow (spec sections 6-9, 74, 97) — tenant-
 * scoped: every rule this controller can see or touch was created BY this
 * tenant (`tenantId` set at create time to the caller's own tenant), never
 * the shared system rules. See `TaxRuleAdminService`'s own docstring for
 * the DRAFT -> REVIEWED -> APPROVED -> ACTIVE -> REPEALED workflow.
 */
@Controller('tax/rules')
export class TaxRuleAdminController {
  constructor(private readonly rules: TaxRuleAdminService) {}

  @RequirePermissions(PermissionCodes.TAX_RULE_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.rules.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.TAX_RULE_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.rules.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.TAX_RULE_CREATE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateTaxRuleDto) {
    return this.rules.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TAX_RULE_EDIT)
  @Post(':id')
  update(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: UpdateTaxRuleDto) {
    return this.rules.update(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.TAX_RULE_EDIT)
  @Post(':id/submit-for-review')
  submitForReview(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.rules.submitForReview(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TAX_RULE_APPROVE)
  @Post(':id/approve')
  approve(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.rules.approve(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TAX_RULE_ACTIVATE)
  @Post(':id/activate')
  activate(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.rules.activate(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TAX_RULE_ACTIVATE)
  @Post(':id/repeal')
  repeal(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: RepealTaxRuleDto) {
    return this.rules.repeal(tenantId, user.userId, id, dto);
  }
}
