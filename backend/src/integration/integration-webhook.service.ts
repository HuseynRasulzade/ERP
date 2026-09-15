import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

/**
 * IntegrationWebhookService (docx spec Phase 28, sections 74-79, 136).
 * `verifySignature` MUST run before any staging/business handling (spec
 * section 209 — "expected reject before staging/business handling") —
 * `IntegrationWebhookController` calls this first thing, and a security
 * audit event is recorded on failure regardless of outcome. Signature
 * verification never delegates trust to a reverse proxy/frontend (spec
 * rule 238's own "webhook signature yoxlamasını frontend/proxy-yə tam
 * etibar edib domain integration-dan çıxarma") — it always runs inside
 * this backend.
 */
@Injectable()
export class IntegrationWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** HMAC-SHA256 signature check over `${timestamp}.${rawBody}`, the
   * common provider convention (Stripe/GitHub-style) — a concrete
   * provider connector can layer its own scheme on top since the secret
   * itself is resolved from a `IntegrationCredentialReference`, never
   * hardcoded here. */
  verifySignature(rawBody: string, timestamp: string, providedSignature: string, secret: string, toleranceSeconds = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS): { valid: boolean; reason?: string } {
    const eventAge = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(eventAge) || eventAge > toleranceSeconds) {
      return { valid: false, reason: `Timestamp outside tolerance window (${toleranceSeconds}s)` };
    }
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(providedSignature, 'hex');
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      return { valid: false, reason: 'Signature mismatch' };
    }
    return { valid: true };
  }

  async recordSignatureFailure(tenantId: string | null, endpointId: string, reason: string) {
    await this.audit.record({ tenantId, eventType: 'WebhookSignatureFailed', eventCategory: 'INTEGRATION_SECURITY', entityType: 'IntegrationEndpoint', entityId: endpointId, operation: 'VALIDATE', action: 'REJECT', userId: null, severity: 'ERROR', metadata: { reason } });
  }

  async recordSignatureSuccess(tenantId: string, endpointId: string, eventId: string) {
    await this.audit.record({ tenantId, eventType: 'SignatureValidated', eventCategory: 'INTEGRATION_SECURITY', entityType: 'IntegrationEndpoint', entityId: endpointId, operation: 'VALIDATE', action: 'ACCEPT', userId: null, metadata: { eventId } });
  }

  createSubscription(tenantId: string, input: { endpointId: string; subscriber: string; events: string[]; targetEndpointReference: string; secretReferenceId?: string; contractVersionId?: string }) {
    return this.prisma.integrationWebhookSubscription.create({
      data: { tenantId, endpointId: input.endpointId, subscriber: input.subscriber, events: input.events as object, targetEndpointReference: input.targetEndpointReference, secretReferenceId: input.secretReferenceId, contractVersionId: input.contractVersionId },
    });
  }

  listSubscriptionsForEvent(tenantId: string, eventType: string) {
    return this.prisma.integrationWebhookSubscription.findMany({ where: { tenantId, active: true } }).then((subs) => subs.filter((s) => (s.events as unknown as string[]).includes(eventType)));
  }
}
