import { Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AzTaxLocalizationService } from './az-tax-localization.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('tax')
export class TaxConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localization: AzTaxLocalizationService,
  ) {}

  @RequirePermissions(PermissionCodes.TAX_CONFIG_VIEW)
  @Post('localization/seed')
  seed() {
    return this.localization.ensureSeeded();
  }

  @RequirePermissions(PermissionCodes.TAX_CONFIG_VIEW)
  @Get('types')
  types() {
    return this.prisma.taxType.findMany();
  }

  @RequirePermissions(PermissionCodes.TAX_RATE_VIEW)
  @Get('rates')
  rates() {
    return this.prisma.taxRate.findMany({ include: { taxType: true, legalSource: true }, orderBy: { effectiveFrom: 'asc' } });
  }

  @RequirePermissions(PermissionCodes.TAX_CATEGORY_VIEW)
  @Get('categories')
  categories() {
    return this.prisma.taxCategory.findMany();
  }

  // The unscoped `GET /tax/rules` that used to live here (returning EVERY
  // tenant's TaxRule rows with no tenantId filter — a real cross-tenant
  // isolation bug, never exercised by any test) has been replaced by
  // `TaxRuleAdminController`'s tenant-scoped `GET /tax/rules` /
  // `GET /tax/rules/:id`, part of this phase's custom-rule admin workflow
  // — see docs/TAX_ENGINE.md.
}
