import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { CounterpartyPricingModule } from '../counterparty-pricing/counterparty-pricing.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';

import { CustomerRequestRepository } from './customer-request.repository';
import { CustomerRequestService } from './customer-request.service';
import { CustomerRequestController } from './customer-request.controller';

import { CommercialOfferRepository } from './commercial-offer.repository';
import { CommercialOfferService } from './commercial-offer.service';
import { CommercialOfferController } from './commercial-offer.controller';

import { CustomerRequestToCommercialOfferMapper } from './customer-request-to-offer.mapper';
import { CommercialOfferToSalesOrderMapper } from './commercial-offer-to-sales-order.mapper';

import { CreditCheckService } from './credit-check.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { ReservationService } from './reservation.service';
import { ShipmentPlanService } from './shipment-plan.service';
import { PaymentScheduleService } from './payment-schedule.service';
import { OrderHoldService } from './order-hold.service';
import {
  SalesOrderPreorderController,
  OrderHoldReleaseController,
  StockReservationReleaseController,
} from './sales-order-preorder.controller';

/**
 * Sales Pre-Order & Order Management (docx spec Phase 6). See
 * docs/SALES_PREORDER.md for the architecture and the deliberate
 * simplifications (no Partner/Contract/Agreement entities — reuses
 * Counterparty directly; SalesOrder plays the CustomerOrder role instead
 * of a duplicate table).
 *
 * Registers CustomerRequest and CommercialOffer as CreateBasedOn-only
 * repositories (no PostingHandler — they never post, spec section 102)
 * plus the two conversion mappers, all through the generic
 * DocumentFrameworkRegistry (Phase 0), on module init.
 */
@Module({
  imports: [
    DocumentFrameworkModule,
    NumberingModule,
    AuditModule,
    OrgStructureModule,
    CounterpartyPricingModule,
    TaxEngineModule,
  ],
  controllers: [
    CustomerRequestController,
    CommercialOfferController,
    SalesOrderPreorderController,
    OrderHoldReleaseController,
    StockReservationReleaseController,
  ],
  providers: [
    CustomerRequestRepository,
    CustomerRequestService,
    CommercialOfferRepository,
    CommercialOfferService,
    CustomerRequestToCommercialOfferMapper,
    CommercialOfferToSalesOrderMapper,
    CreditCheckService,
    OrderFulfillmentService,
    ReservationService,
    ShipmentPlanService,
    PaymentScheduleService,
    OrderHoldService,
  ],
  exports: [CreditCheckService, OrderFulfillmentService, ReservationService],
})
export class SalesPreorderModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly customerRequestRepository: CustomerRequestRepository,
    private readonly commercialOfferRepository: CommercialOfferRepository,
    private readonly requestToOfferMapper: CustomerRequestToCommercialOfferMapper,
    private readonly offerToOrderMapper: CommercialOfferToSalesOrderMapper,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.customerRequestRepository);
    this.registry.registerRepository(this.commercialOfferRepository);
    this.registry.registerMapper(this.requestToOfferMapper);
    this.registry.registerMapper(this.offerToOrderMapper);
  }
}
