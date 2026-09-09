import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';

import { UnitConversionService } from './unit-conversion.service';
import { UnitConversionController } from './unit-conversion.controller';

import { CounterpartyService } from './counterparty.service';
import { CounterpartyController } from './counterparty.controller';

import { PriceListService } from './price-list.service';
import { PriceListController } from './price-list.controller';

/**
 * Phase 3 — Counterparty Master Data + Pricing. Customer/supplier management,
 * unit conversions, price lists, and product pricing. Master data only —
 * no sales orders, purchase orders, invoices, or payments yet (Phase 4+).
 * Builds on Phase 0/1/2: reuses audit, organization access, and product catalog.
 */
@Module({
  imports: [AuditModule, OrgStructureModule],
  controllers: [UnitConversionController, CounterpartyController, PriceListController],
  providers: [UnitConversionService, CounterpartyService, PriceListService],
  exports: [UnitConversionService, CounterpartyService, PriceListService],
})
export class CounterpartyPricingModule {}
