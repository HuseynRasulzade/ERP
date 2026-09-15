import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DocumentChainModule } from '../document-chain/document-chain.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';

import { IntegrationConnectorRegistry } from './integration-connector-registry.service';
import { GenericRestConnectorAdapter, GenericWebhookConnectorAdapter, GenericCsvConnectorAdapter } from './connectors/generic-connectors';
import { IntegrationEndpointService } from './integration-endpoint.service';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationContractService } from './integration-contract.service';
import { IntegrationPayloadService } from './integration-payload.service';
import { IntegrationMappingService } from './integration-mapping.service';
import { IntegrationMessageService } from './integration-message.service';
import { IntegrationSchemaValidationService } from './integration-schema-validation.service';
import { IntegrationStagingService } from './integration-staging.service';
import { ExternalEntityReferenceService } from './external-entity-reference.service';
import { IntegrationMatchingService } from './integration-matching.service';
import { IntegrationDeduplicationService } from './integration-deduplication.service';
import { IntegrationCommandRegistry } from './integration-command-registry.service';
import { IntegrationImportService } from './integration-import.service';
import { IntegrationRetryService } from './integration-retry.service';
import { IntegrationDeadLetterService } from './integration-dead-letter.service';
import { IntegrationWebhookService } from './integration-webhook.service';
import { IntegrationPollingService } from './integration-polling.service';
import { IntegrationExportService } from './integration-export.service';
import { IntegrationReconciliationService } from './integration-reconciliation.service';
import { ExternalSyncStateService } from './integration-sync-state.service';
import { IntegrationObservabilityService } from './integration-observability.service';
import { IntegrationHealthService } from './integration-health.service';
import { IntegrationController } from './integration.controller';

/**
 * Integration Platform / Connector Framework / Import-Export Engine
 * (docx spec Phase 28). See docs/INTEGRATION_PLATFORM.md. Imports
 * `WorkflowModule` (safe condition DSL, reused by `IntegrationMappingService`
 * for CONDITIONAL mappings) and `DocumentChainModule` (Phase 27's safe
 * mapping primitives, reused for DIRECT/CONSTANT/LOOKUP/IGNORE/
 * REQUIRED_MANUAL) rather than building parallel engines, and
 * `IdempotencyModule` (Phase 0's own generic idempotency infrastructure,
 * reused as-is for `IntegrationIdempotencyRecord` — no new table).
 * Deliberately does NOT import any business module (Sales, Purchase,
 * Bank, ...): those register their own `IntegrationCommandHandler`/
 * `SourceEligibilityAdapter`-style adapters into this module's registries
 * from their OWN module's `onModuleInit`, keeping the dependency
 * direction one-way (business modules depend on the integration
 * platform's stable contracts, never the reverse).
 */
@Module({
  imports: [AuditModule, WorkflowModule, DocumentChainModule, IdempotencyModule],
  controllers: [IntegrationController],
  providers: [
    IntegrationConnectorRegistry,
    GenericRestConnectorAdapter,
    GenericWebhookConnectorAdapter,
    GenericCsvConnectorAdapter,
    IntegrationEndpointService,
    IntegrationCredentialService,
    IntegrationContractService,
    IntegrationPayloadService,
    IntegrationMappingService,
    IntegrationMessageService,
    IntegrationSchemaValidationService,
    IntegrationStagingService,
    ExternalEntityReferenceService,
    IntegrationMatchingService,
    IntegrationDeduplicationService,
    IntegrationCommandRegistry,
    IntegrationImportService,
    IntegrationRetryService,
    IntegrationDeadLetterService,
    IntegrationWebhookService,
    IntegrationPollingService,
    IntegrationExportService,
    IntegrationReconciliationService,
    ExternalSyncStateService,
    IntegrationObservabilityService,
    IntegrationHealthService,
  ],
  exports: [
    IntegrationConnectorRegistry,
    IntegrationCommandRegistry,
    IntegrationContractService,
    IntegrationMatchingService,
    IntegrationMessageService,
    IntegrationImportService,
    IntegrationExportService,
    ExternalEntityReferenceService,
    ExternalSyncStateService,
  ],
})
export class IntegrationModule implements OnModuleInit {
  constructor(
    private readonly registry: IntegrationConnectorRegistry,
    private readonly restAdapter: GenericRestConnectorAdapter,
    private readonly webhookAdapter: GenericWebhookConnectorAdapter,
    private readonly csvAdapter: GenericCsvConnectorAdapter,
  ) {}

  onModuleInit() {
    this.registry.registerAdapter(this.restAdapter);
    this.registry.registerAdapter(this.webhookAdapter);
    this.registry.registerAdapter(this.csvAdapter);
  }
}
