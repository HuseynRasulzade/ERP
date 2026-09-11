import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { CounterpartyPricingModule } from '../counterparty-pricing/counterparty-pricing.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';

import { CounterpartyContractService } from './counterparty-contract.service';
import { CounterpartyContractsForCounterpartyController, CounterpartyContractController } from './counterparty-contract.controller';

import { CounterpartyContractAmendmentService } from './counterparty-contract-amendment.service';
import { ContractAmendmentsForContractController, ContractAmendmentController } from './counterparty-contract-amendment.controller';

import { CounterpartyDocumentService } from './counterparty-document.service';
import { CounterpartyDocumentController } from './counterparty-document.controller';

/**
 * "Kontragentlər" module extension: contracts, contract amendments, and
 * their document attachments (spec sections 5-7). Builds on
 * CounterpartyPricingModule (Phase 3) for the counterparty row itself —
 * never modifies it, only reads via `CounterpartyService.get` to validate
 * a contract's owning counterparty. See docs/COUNTERPARTY_MANAGEMENT.md.
 */
@Module({
  imports: [AuditModule, OrgStructureModule, CounterpartyPricingModule, TaxEngineModule],
  controllers: [
    CounterpartyContractsForCounterpartyController,
    CounterpartyContractController,
    ContractAmendmentsForContractController,
    ContractAmendmentController,
    CounterpartyDocumentController,
  ],
  providers: [CounterpartyContractService, CounterpartyContractAmendmentService, CounterpartyDocumentService],
  exports: [CounterpartyContractService, CounterpartyContractAmendmentService, CounterpartyDocumentService],
})
export class CounterpartyContractsModule {}
