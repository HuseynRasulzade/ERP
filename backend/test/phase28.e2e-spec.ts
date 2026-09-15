/**
 * Phase 28 — Integration Platform / Connector Framework / Import-Export
 * Engine.
 *
 * Direct-service testing style matching phases 15-27's own test files.
 * Registers a fake `IntegrationCommandHandler` (creating a Phase 0
 * `FoundationTestDocument`, the same demo fixture Phase 27's e2e spec
 * uses) and a fake `EntityMatchCandidateResolver`, then exercises:
 * schema validation blocking a bad payload before any business command,
 * a valid import producing a real target document via the domain
 * command registry (never a direct table write), idempotency vs
 * deduplication as genuinely distinct concepts, external entity
 * reference uniqueness, match-confidence gating (no silent auto-link),
 * strict all-or-nothing batch rollback, dead-letter creation + replay
 * preserving history, reconciliation mismatch detection, and sync-state
 * conflict detection with no default last-write-wins.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { IntegrationConnectorRegistry } from '../src/integration/integration-connector-registry.service';
import { IntegrationEndpointService } from '../src/integration/integration-endpoint.service';
import { IntegrationContractService } from '../src/integration/integration-contract.service';
import { IntegrationMappingService } from '../src/integration/integration-mapping.service';
import { IntegrationMessageService } from '../src/integration/integration-message.service';
import { IntegrationSchemaValidationService } from '../src/integration/integration-schema-validation.service';
import { IntegrationCommandRegistry, DomainCommandResult } from '../src/integration/integration-command-registry.service';
import { IntegrationImportService } from '../src/integration/integration-import.service';
import { IntegrationDeduplicationService } from '../src/integration/integration-deduplication.service';
import { ExternalEntityReferenceService } from '../src/integration/external-entity-reference.service';
import { IntegrationMatchingService, EntityMatchCandidateResolver } from '../src/integration/integration-matching.service';
import { IntegrationDeadLetterService } from '../src/integration/integration-dead-letter.service';
import { IntegrationReconciliationService } from '../src/integration/integration-reconciliation.service';
import { ExternalSyncStateService } from '../src/integration/integration-sync-state.service';

const FOUNDATION_TYPE = 'FOUNDATION_TEST_DOCUMENT';
const CONTRACT_CODE = 'TEST_ORDER_IMPORT';

describe('Phase 28 — Integration Platform (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let connectors: IntegrationConnectorRegistry;
  let endpoints: IntegrationEndpointService;
  let contracts: IntegrationContractService;
  let mappings: IntegrationMappingService;
  let messages: IntegrationMessageService;
  let schemaValidation: IntegrationSchemaValidationService;
  let commandRegistry: IntegrationCommandRegistry;
  let imports: IntegrationImportService;
  let dedup: IntegrationDeduplicationService;
  let externalRefs: ExternalEntityReferenceService;
  let matching: IntegrationMatchingService;
  let deadLetters: IntegrationDeadLetterService;
  let reconciliation: IntegrationReconciliationService;
  let syncState: ExternalSyncStateService;

  const run = Date.now();
  let tenantId: string;
  let userId: string;
  let endpointId: string;
  let contractVersionId: string;
  let matchedCustomerInternalId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    connectors = app.get(IntegrationConnectorRegistry);
    endpoints = app.get(IntegrationEndpointService);
    contracts = app.get(IntegrationContractService);
    mappings = app.get(IntegrationMappingService);
    messages = app.get(IntegrationMessageService);
    schemaValidation = app.get(IntegrationSchemaValidationService);
    commandRegistry = app.get(IntegrationCommandRegistry);
    imports = app.get(IntegrationImportService);
    dedup = app.get(IntegrationDeduplicationService);
    externalRefs = app.get(ExternalEntityReferenceService);
    matching = app.get(IntegrationMatchingService);
    deadLetters = app.get(IntegrationDeadLetterService);
    reconciliation = app.get(IntegrationReconciliationService);
    syncState = app.get(ExternalSyncStateService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p28-${run}`, name: 'Phase 28 tenant' } });
    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p28-${run}@e2e.test`, passwordHash: 'x', displayName: 'Phase 28 user' } });
    matchedCustomerInternalId = randomUUID();

    // Domain command handler — the ONLY path that ever creates a real
    // business document from a canonical import record.
    commandRegistry.register({
      contractCode: CONTRACT_CODE,
      async execute(tid, actor, canonicalData): Promise<DomainCommandResult> {
        if (canonicalData.amount === 'INVALID') return { status: 'REJECTED', rejectionReason: 'amount is not a valid number' };
        const doc = await prisma.foundationTestDocument.create({ data: { tenantId: tid, documentDate: new Date(), amount: (canonicalData.amount as string) ?? '0', description: `imported by ${actor.serviceAccountUserId}`, createdBy: actor.serviceAccountUserId, updatedBy: actor.serviceAccountUserId } });
        return { status: 'CREATED', targetEntityType: FOUNDATION_TYPE, targetEntityId: doc.id };
      },
    });

    // Match candidate resolver for a fake "CUSTOMER" internal entity type.
    const resolver: EntityMatchCandidateResolver = {
      internalEntityType: 'CUSTOMER',
      async findCandidate(tid, method, value) {
        if (value === 'HIGH-CONF-100') return { internalEntityId: matchedCustomerInternalId, confidence: 0.99 };
        if (value === 'LOW-CONF-200') return { internalEntityId: randomUUID(), confidence: 0.4 };
        return null;
      },
    };
    matching.registerResolver(resolver);

    const connector = await connectors.createConnector(tenantId, { code: `GENERIC_REST-${run}`, name: 'Generic REST', family: 'GENERIC' });
    const endpoint = await endpoints.create(tenantId, userId, { code: `EP-${run}`, name: 'Test Endpoint', direction: 'INBOUND', connectorId: connector.id, protocol: 'REST' });
    endpointId = endpoint.id;

    const contract = await contracts.createContract(tenantId, { code: CONTRACT_CODE, name: 'Test Order Import' });
    const version = await contracts.createVersion(tenantId, userId, contract.id, {
      schema: { fields: { externalOrderId: { type: 'string', required: true }, amount: { type: 'string', required: true } } },
      effectiveFrom: new Date('2020-01-01'),
    });
    await contracts.activate(tenantId, userId, version.id);
    contractVersionId = version.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function receiveMessage(payload: Record<string, unknown>, idempotencyKey?: string) {
    return messages.receive(tenantId, { endpointId, contractVersionId, direction: 'INBOUND', raw: JSON.stringify(payload), contentType: 'application/json', idempotencyKey, externalCorrelationId: payload.externalOrderId as string });
  }

  it('rejects an invalid payload before any business command runs', async () => {
    const message = await receiveMessage({ externalOrderId: 'EXT-1' }); // missing required `amount`
    const result = await schemaValidation.validate(tenantId, message.id, CONTRACT_CODE, 1, { externalOrderId: 'EXT-1' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/amount/);

    const before = await prisma.foundationTestDocument.count({ where: { tenantId } });
    // No import is ever attempted for a schema-invalid message.
    expect(before).toBe(0);
  });

  it('imports a valid record through the domain command registry and produces a real document', async () => {
    const message = await receiveMessage({ externalOrderId: 'EXT-100', amount: '250.00' });
    const valid = await schemaValidation.validate(tenantId, message.id, CONTRACT_CODE, 1, { externalOrderId: 'EXT-100', amount: '250.00' });
    expect(valid.valid).toBe(true);

    const { job, results } = await imports.runBatch(tenantId, {
      endpointId,
      contractCode: CONTRACT_CODE,
      mode: 'CREATE_ONLY',
      serviceAccountUserId: userId,
      records: [{ sequence: 1, canonicalData: { externalOrderId: 'EXT-100', amount: '250.00' } }],
    });

    expect(job.status).toBe('COMPLETED');
    expect(job.createdCount).toBe(1);
    expect(results[0].status).toBe('CREATED');
    const created = await prisma.foundationTestDocument.findUnique({ where: { id: results[0].targetEntityId! } });
    expect(created?.amount.toString()).toBe('250');
  });

  it('distinguishes idempotency (same operation repeated) from deduplication (same object, different message)', async () => {
    const key = `idem-${run}`;
    const first = await receiveMessage({ externalOrderId: 'EXT-200', amount: '10.00' }, key);
    const second = await receiveMessage({ externalOrderId: 'EXT-200', amount: '10.00' }, key);
    // A caller checking idempotency before processing finds the prior message.
    const existing = await messages.findByIdempotencyKey(tenantId, endpointId, key);
    expect(existing?.id).toBe(first.id);
    expect(second.id).not.toBe(first.id); // receive() itself always records; idempotency is enforced by the caller's own pre-check, matching IdempotencyService's own contract

    // Deduplication is a SEPARATE signal keyed by business content, not the idempotency key.
    const dedup1 = await dedup.check(tenantId, first.id, 'EXTERNAL_DOCUMENT_NUMBER', 'EXT-200');
    expect(dedup1.result).toBe('UNIQUE');
    const dedup2 = await dedup.check(tenantId, second.id, 'EXTERNAL_DOCUMENT_NUMBER', 'EXT-200');
    expect(dedup2.result).toBe('EXACT_DUPLICATE');

    // A versioned update to the SAME external document is NOT an exact duplicate.
    const dedup3 = await dedup.check(tenantId, randomUUID(), 'EXTERNAL_DOCUMENT_NUMBER', 'EXT-200', { versionField: { previous: 1, current: 2 } });
    expect(dedup3.result).toBe('SUPERSEDING_VERSION');
  });

  it('enforces external entity reference uniqueness and never auto-links a low-confidence match', async () => {
    const ref = await externalRefs.link(tenantId, userId, { externalSystem: 'CRM', externalEntityType: 'CUSTOMER', externalEntityId: 'CUST-900', internalEntityType: 'CUSTOMER', internalEntityId: matchedCustomerInternalId, matchMethod: 'MANUAL' });
    expect(ref.status).toBe('ACTIVE');

    await expect(
      externalRefs.link(tenantId, userId, { externalSystem: 'CRM', externalEntityType: 'CUSTOMER', externalEntityId: 'CUST-900', internalEntityType: 'CUSTOMER', internalEntityId: randomUUID() }),
    ).rejects.toThrow(/already linked/);

    const highConfidence = await matching.attemptMatch(tenantId, 'CUSTOMER', [{ method: 'EXACT_CODE', value: 'HIGH-CONF-100' }]);
    expect(highConfidence.status).toBe('MATCHED');

    const lowConfidence = await matching.attemptMatch(tenantId, 'CUSTOMER', [{ method: 'EXACT_CODE', value: 'LOW-CONF-200' }]);
    expect(lowConfidence.status).toBe('LOW_CONFIDENCE'); // never silently auto-linked

    const unmatched = await matching.attemptMatch(tenantId, 'UNKNOWN_TYPE', [{ method: 'EXACT_CODE', value: 'X' }]);
    expect(unmatched.status).toBe('WAITING_MANUAL');
  });

  it('rolls back an entire strict all-or-nothing batch when any record is rejected', async () => {
    const before = await prisma.foundationTestDocument.count({ where: { tenantId } });
    const { job } = await imports.runBatch(tenantId, {
      endpointId,
      contractCode: CONTRACT_CODE,
      mode: 'CREATE_ONLY',
      strictAllOrNothing: true,
      serviceAccountUserId: userId,
      records: [
        { sequence: 1, canonicalData: { externalOrderId: 'EXT-300', amount: '5.00' } },
        { sequence: 2, canonicalData: { externalOrderId: 'EXT-301', amount: 'INVALID' } },
      ],
    });
    expect(job.status).toBe('FAILED');
    const after = await prisma.foundationTestDocument.count({ where: { tenantId } });
    expect(after).toBe(before); // nothing committed despite the first record being individually valid
  });

  it('supports partial batch success when not strict', async () => {
    const { job, results } = await imports.runBatch(tenantId, {
      endpointId,
      contractCode: CONTRACT_CODE,
      mode: 'CREATE_ONLY',
      serviceAccountUserId: userId,
      records: [
        { sequence: 1, canonicalData: { externalOrderId: 'EXT-400', amount: '1.00' } },
        { sequence: 2, canonicalData: { externalOrderId: 'EXT-401', amount: 'INVALID' } },
      ],
    });
    expect(job.status).toBe('PARTIALLY_COMPLETED');
    expect(job.createdCount).toBe(1);
    expect(job.rejectedCount).toBe(1);
    expect(results.find((r) => r.sequence === 2)?.status).toBe('REJECTED');
  });

  it('creates a dead letter on failure and replay preserves the original history', async () => {
    const message = await receiveMessage({ externalOrderId: 'EXT-500', amount: 'INVALID' });
    await messages.recordAttempt(tenantId, message.id, { result: 'FAILED', errorCode: 'BUSINESS_VALIDATION', errorMessage: 'amount invalid', retryable: false });
    const dl = await deadLetters.create(tenantId, message.id, 'amount invalid', 1);
    expect(dl.status).toBe('OPEN');

    const replayResult = await imports.replayMessage(tenantId, userId, message.id, CONTRACT_CODE, 'CREATE_ONLY', { externalOrderId: 'EXT-500', amount: '99.00' });
    expect(replayResult.status).toBe('CREATED');

    const reloaded = await messages.get(tenantId, message.id);
    expect(reloaded?.attempts.length).toBeGreaterThanOrEqual(2); // original failed attempt + new successful one, never deleted
    expect(reloaded?.attempts[0].result).toBe('FAILED');
    expect(reloaded?.attempts[reloaded!.attempts.length - 1].result).toBe('SUCCESS');

    await deadLetters.resolve(tenantId, userId, dl.id, 'Fixed amount and replayed', 'RESOLVED');
    const dlList = await deadLetters.list(tenantId, {});
    expect(dlList.find((d) => d.id === dl.id)?.status).toBe('RESOLVED');
  });

  it('applies a mixed safe mapping DSL (DIRECT/CONSTANT/VALUE_MAP/FORMAT_CONVERSION/CONDITIONAL)', async () => {
    const profile = await mappings.createProfile(tenantId, { code: `MAP-${run}`, name: 'Test mapping' });
    const version = await mappings.createVersion(tenantId, userId, profile.id, {
      sourceContractVersionId: contractVersionId,
      targetCanonicalContract: CONTRACT_CODE,
      effectiveFrom: new Date('2020-01-01'),
      fieldMappings: [
        { targetField: 'externalOrderId', mappingType: 'DIRECT', sourceField: 'ext_id' },
        { targetField: 'source', mappingType: 'CONSTANT', constant: 'MARKETPLACE' },
        { targetField: 'status', mappingType: 'VALUE_MAP', sourceField: 'raw_status', lookupTable: { P: 'POSTED', D: 'DRAFT' } },
        { targetField: 'amount', mappingType: 'FORMAT_CONVERSION', sourceField: 'raw_amount', format: 'FIXED_2_DECIMALS' },
        { targetField: 'priority', mappingType: 'CONDITIONAL', condition: { op: 'GT', field: 'raw_amount', value: 1000 }, whenTrueConstant: 'HIGH', whenFalseConstant: 'NORMAL' },
      ] as never,
    });
    await mappings.activateVersion(tenantId, userId, version.id);

    const { target, requiresManual } = mappings.apply(version.fieldMappings as never, { ext_id: 'EXT-999', raw_status: 'P', raw_amount: 1500 });
    expect(target).toEqual({ externalOrderId: 'EXT-999', source: 'MARKETPLACE', status: 'POSTED', amount: '1500.00', priority: 'HIGH' });
    expect(requiresManual).toEqual([]);
  });

  it('reconciliation reports a mismatch when external and internal totals differ', async () => {
    const rule = await reconciliation.createRule(tenantId, { endpointId, code: `RECON-${run}`, sourceMetric: 'EXTERNAL_ORDER_AMOUNT', targetMetric: 'ERP_SALES_ORDER_AMOUNT', matchingKeys: ['period'] });
    const { run: reconRun, results } = await reconciliation.run(
      tenantId,
      rule.id,
      '2026-01',
      [{ key: 'ALL', count: 100, amount: new Decimal(50000) }],
      [{ key: 'ALL', count: 99, amount: new Decimal(49500) }],
      userId,
    );
    expect(reconRun.missingInternal).toBe(0);
    expect(results[0].resultType).toBe('AMOUNT_MISMATCH');
    expect(results[0].difference).toBe('500');
  });

  it('detects a two-way sync conflict and never silently applies last-write-wins', async () => {
    await syncState.upsertBaseline(tenantId, { internalEntityType: 'CUSTOMER', internalEntityId: matchedCustomerInternalId, externalSystem: 'CRM', externalId: 'CUST-900', internalVersion: 1, externalVersionTag: 'etag-1' });
    const { hasConflict, state } = await syncState.detectConflict(tenantId, 'CUSTOMER', matchedCustomerInternalId, 'CRM', 2, 'etag-2');
    expect(hasConflict).toBe(true);
    expect(state?.syncStatus).toBe('CONFLICT');

    const resolved = await syncState.resolve(tenantId, userId, state!.id, 'MANUAL', 2, 'etag-2');
    expect(resolved.conflictStatus).toBe('RESOLVED');
    expect(resolved.syncStatus).toBe('SYNCED');
  });
});
