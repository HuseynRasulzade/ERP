import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PayrollCatalogService } from './payroll-catalog.service';
import { PayrollLegalRulesService } from './payroll-legal-rules.service';
import { PayrollTaxProfileService } from './payroll-tax-profile.service';
import {
  CreateContributionBracketDto,
  CreateDeductionDefinitionDto,
  CreateEarningDefinitionDto,
  CreateLegalRuleSetDto,
  CreateTaxBracketDto,
  CreateTaxProfileDto,
  CreateTaxReliefDto,
} from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('payroll/setup')
export class PayrollSetupController {
  constructor(
    private readonly catalog: PayrollCatalogService,
    private readonly legalRules: PayrollLegalRulesService,
    private readonly taxProfiles: PayrollTaxProfileService,
  ) {}

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('seed-defaults')
  seedDefaults(@CurrentTenantId() tenantId: string) {
    return this.catalog.seedDefaults(tenantId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('seed-az-localization-2026')
  seedAzLocalization(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.legalRules.seedAzLocalization2026(tenantId, user.userId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('earnings')
  listEarnings(@CurrentTenantId() tenantId: string) {
    return this.catalog.listEarnings(tenantId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('earnings')
  createEarning(@CurrentTenantId() tenantId: string, @Body() dto: CreateEarningDefinitionDto) {
    return this.catalog.createEarning(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('deductions')
  listDeductions(@CurrentTenantId() tenantId: string) {
    return this.catalog.listDeductions(tenantId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('deductions')
  createDeduction(@CurrentTenantId() tenantId: string, @Body() dto: CreateDeductionDefinitionDto) {
    return this.catalog.createDeduction(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('legal-rule-sets')
  createRuleSet(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateLegalRuleSetDto,
  ) {
    return this.legalRules.createRuleSet(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_LEGAL_TRACE)
  @Get('legal-rule-sets')
  listRuleSets(@CurrentTenantId() tenantId: string) {
    return this.legalRules.listRuleSets(tenantId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('tax-brackets')
  createTaxBracket(@CurrentTenantId() tenantId: string, @Body() dto: CreateTaxBracketDto) {
    return this.legalRules.createTaxBracket(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('contribution-brackets')
  createContributionBracket(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateContributionBracketDto,
  ) {
    return this.legalRules.createContributionBracket(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post('tax-reliefs')
  createTaxRelief(@CurrentTenantId() tenantId: string, @Body() dto: CreateTaxReliefDto) {
    return this.legalRules.createTaxRelief(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_TAX)
  @Get('tax-profiles')
  listTaxProfiles(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId: string) {
    return this.taxProfiles.list(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_EDIT_TAX_PROFILE)
  @Post('tax-profiles')
  createTaxProfile(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateTaxProfileDto,
  ) {
    return this.taxProfiles.create(tenantId, user.userId, dto);
  }
}
