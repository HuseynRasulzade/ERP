import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { IntegrationPayloadService } from './integration-payload.service';

export type MessageStatus = 'RECEIVED' | 'VALIDATING' | 'STAGED' | 'PROCESSING' | 'PROCESSED' | 'PARTIALLY_PROCESSED' | 'REJECTED' | 'RETRY_PENDING' | 'DEAD_LETTER' | 'CANCELLED';

export interface ReceiveMessageInput {
  organizationId?: string;
  endpointId: string;
  contractVersionId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  raw: Buffer | string;
  contentType: string;
  sourceSystem?: string;
  eventType?: string;
  occurredAt?: Date; // provider-declared event time, with its own original offset preserved separately
  originalTimestampRaw?: string;
  originalTimezoneOffset?: string;
  businessEffectiveDate?: Date;
  externalCorrelationId?: string;
  idempotencyKey?: string;
  currencyId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * IntegrationMessageService (docx spec Phase 28, sections 25-27, 117-
 * 118). Every inbound/outbound message is recorded here BEFORE any
 * mapping/staging/domain-command work happens — the raw payload is
 * hashed and preserved (`IntegrationPayloadService`) and both the
 * original externally-declared timestamp/offset and the normalized
 * `receivedAt`/`businessEffectiveDate` are kept (spec sections 117-118 —
 * "external event received today may economically belong to
 * yesterday").
 */
@Injectable()
export class IntegrationMessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payloads: IntegrationPayloadService,
  ) {}

  async receive(tenantId: string, input: ReceiveMessageInput, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const payloadRef = await this.payloads.store(tenantId, input.raw, input.contentType, {}, tx);

    const message = await client.integrationMessage.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        endpointId: input.endpointId,
        contractVersionId: input.contractVersionId,
        direction: input.direction,
        status: 'RECEIVED',
        sourceSystem: input.sourceSystem,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        originalTimestampRaw: input.originalTimestampRaw,
        originalTimezoneOffset: input.originalTimezoneOffset,
        businessEffectiveDate: input.businessEffectiveDate,
        externalCorrelationId: input.externalCorrelationId,
        idempotencyKey: input.idempotencyKey,
        payloadReferenceId: payloadRef.id,
        currencyId: input.currencyId,
        metadata: (input.metadata ?? null) as object | undefined,
      },
    });

    await this.audit.record({ tenantId, organizationId: input.organizationId, eventType: 'MessageReceived', eventCategory: 'INTEGRATION', entityType: 'IntegrationMessage', entityId: message.id, operation: 'CREATE', action: 'CREATE', userId: null, metadata: { endpointId: input.endpointId, direction: input.direction, payloadHash: payloadRef.hash } }, tx);
    return message;
  }

  async transition(tenantId: string, messageId: string, status: MessageStatus, extra: { rejectionReason?: string } = {}, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const message = await client.integrationMessage.findFirst({ where: { id: messageId, tenantId } });
    if (!message) throw new NotFoundAppError('IntegrationMessage', messageId);
    return client.integrationMessage.update({ where: { id: messageId }, data: { status, rejectionReason: extra.rejectionReason } });
  }

  /** Message attempts are append-only (spec section 27 — "do not
   * overwrite prior attempts"): each call always INSERTs a new row,
   * numbered by the count of attempts so far. */
  async recordAttempt(
    tenantId: string,
    messageId: string,
    result: { result: 'SUCCESS' | 'FAILED' | 'RETRYING'; providerStatus?: string; errorCode?: string; errorMessage?: string; retryable?: boolean; responseReference?: string },
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const priorCount = await client.integrationMessageAttempt.count({ where: { tenantId, messageId } });
    return client.integrationMessageAttempt.create({
      data: {
        tenantId,
        messageId,
        attemptNumber: priorCount + 1,
        completedAt: new Date(),
        result: result.result,
        providerStatus: result.providerStatus,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        retryable: result.retryable ?? false,
        responseReference: result.responseReference,
      },
    });
  }

  get(tenantId: string, messageId: string) {
    return this.prisma.integrationMessage.findFirst({ where: { id: messageId, tenantId }, include: { attempts: { orderBy: { attemptNumber: 'asc' } }, stagingRecords: true, payloadReference: true } });
  }

  list(tenantId: string, filters: { endpointId?: string; status?: MessageStatus; direction?: 'INBOUND' | 'OUTBOUND' } = {}) {
    return this.prisma.integrationMessage.findMany({ where: { tenantId, ...filters }, orderBy: { receivedAt: 'desc' }, take: 200 });
  }

  async findByIdempotencyKey(tenantId: string, endpointId: string, idempotencyKey: string) {
    return this.prisma.integrationMessage.findFirst({ where: { tenantId, endpointId, idempotencyKey } });
  }
}
