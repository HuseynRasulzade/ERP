import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { IntegrationContractService } from './integration-contract.service';
import { IntegrationMessageService } from './integration-message.service';

/**
 * IntegrationSchemaValidationService — the named "Schema Validation"
 * layer from spec section 32/163 as its own service (audited
 * separately from mapping/referential/business validation), thin over
 * `IntegrationContractService.validatePayload` (never a second schema
 * engine).
 */
@Injectable()
export class IntegrationSchemaValidationService {
  constructor(
    private readonly contracts: IntegrationContractService,
    private readonly messages: IntegrationMessageService,
    private readonly audit: AuditService,
  ) {}

  async validate(tenantId: string, messageId: string, contractCode: string, contractVersion: number, payload: Record<string, unknown>) {
    const { version } = await this.contracts.resolveVersion(tenantId, contractCode, contractVersion);
    const errors = this.contracts.validatePayload(version.schema as never, payload);

    if (errors.length > 0) {
      await this.audit.record({ tenantId, eventType: 'SchemaValidationFailed', eventCategory: 'INTEGRATION', entityType: 'IntegrationMessage', entityId: messageId, operation: 'VALIDATE', action: 'REJECT', userId: null, metadata: { contractCode, contractVersion, errors } });
      await this.messages.recordAttempt(tenantId, messageId, { result: 'FAILED', errorCode: 'SCHEMA_ERROR', errorMessage: errors.join('; '), retryable: false });
    }
    return { valid: errors.length === 0, errors };
  }
}
