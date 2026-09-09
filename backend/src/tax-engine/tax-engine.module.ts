import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

import { AzTaxLocalizationService } from './az-tax-localization.service';
import { TaxRoundingService } from './tax-rounding.service';
import { TaxRuleResolverService } from './tax-rule-resolver.service';
import { TaxCalculationService } from './tax-calculation.service';
import { TaxRegisterService } from './tax-register.service';
import { TaxRegistrationService } from './tax-registration.service';

import { TaxConfigController } from './tax-config.controller';
import { TaxCalculationController } from './tax-calculation.controller';
import { TaxRegistrationsController } from './tax-registrations.controller';
import { TaxRegisterController } from './tax-register.controller';

/**
 * Tax Engine (docx spec Phase 5). Depends on AccountingCoreModule for
 * AccountingMappingService (semantic VAT_* account resolution) and
 * AccountingPostingEngine's types (accounting posting lines this module
 * returns but never itself posts — spec section 5/114).
 */
@Module({
  imports: [PrismaModule, AuditModule, OrgStructureModule, AccountingCoreModule],
  controllers: [TaxConfigController, TaxCalculationController, TaxRegistrationsController, TaxRegisterController],
  providers: [
    AzTaxLocalizationService,
    TaxRoundingService,
    TaxRuleResolverService,
    TaxCalculationService,
    TaxRegisterService,
    TaxRegistrationService,
  ],
  exports: [AzTaxLocalizationService, TaxCalculationService, TaxRegisterService, TaxRegistrationService, TaxRuleResolverService],
})
export class TaxEngineModule {}
