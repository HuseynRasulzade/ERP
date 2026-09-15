import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

export interface CreateEndpointInput {
  code: string;
  name: string;
  direction: 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
  connectorId: string;
  protocol: string;
  environment?: 'TEST' | 'SANDBOX' | 'PRODUCTION';
  organizationId?: string;
  baseEndpointReference?: string;
  credentialReferenceId?: string;
  timeoutPolicy?: { connectMs?: number; readMs?: number };
  rateLimitPolicy?: { perSecond?: number; perMinute?: number; burst?: number };
  retryPolicyId?: string;
}

/**
 * IntegrationEndpointService (docx spec Phase 28, sections 4-6, 15).
 * `testConnection` deliberately never mutates business data (spec
 * section 15) — in this build (no live network egress in the sandbox
 * this backend runs in) it validates the endpoint's own configuration
 * (credential present when required, enabled, environment consistent
 * with its credential) rather than performing a real provider call; a
 * concrete connector adapter can extend this with a real reachability
 * check later without changing the contract.
 */
@Injectable()
export class IntegrationEndpointService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.integrationEndpoint.findMany({ where: { tenantId }, include: { connector: true, credential: true } });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.integrationEndpoint.findFirst({ where: { id, tenantId }, include: { connector: true, credential: true, retryPolicy: true } });
    if (!row) throw new NotFoundAppError('IntegrationEndpoint', id);
    return row;
  }

  async create(tenantId: string, userId: string, input: CreateEndpointInput) {
    if (!input.code || !input.connectorId) throw new ValidationAppError('code and connectorId are required');
    const row = await this.prisma.integrationEndpoint.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        code: input.code,
        name: input.name,
        direction: input.direction,
        connectorId: input.connectorId,
        protocol: input.protocol,
        environment: input.environment ?? 'TEST',
        baseEndpointReference: input.baseEndpointReference,
        credentialReferenceId: input.credentialReferenceId,
        timeoutPolicy: (input.timeoutPolicy ?? null) as object | undefined,
        rateLimitPolicy: (input.rateLimitPolicy ?? null) as object | undefined,
        retryPolicyId: input.retryPolicyId,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'EndpointCreated', eventCategory: 'INTEGRATION', entityType: 'IntegrationEndpoint', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { code: input.code, direction: input.direction, environment: row.environment } });
    return row;
  }

  async setEnabled(tenantId: string, userId: string, id: string, enabled: boolean) {
    const endpoint = await this.get(tenantId, id);
    const updated = await this.prisma.integrationEndpoint.update({ where: { id }, data: { enabled, status: enabled ? 'ACTIVE' : 'DISABLED' } });
    await this.audit.record({ tenantId, eventType: enabled ? 'EndpointEnabled' : 'EndpointDisabled', eventCategory: 'INTEGRATION', entityType: 'IntegrationEndpoint', entityId: id, operation: 'UPDATE', action: 'UPDATE', userId, metadata: { previousStatus: endpoint.status } });
    return updated;
  }

  /** Sandbox/production isolation (spec section 140): PRODUCTION
   * endpoints must reference a PRODUCTION-environment credential — a
   * TEST/SANDBOX credential accidentally wired to a production endpoint
   * is rejected outright rather than silently allowed. */
  async testConnection(tenantId: string, id: string) {
    const endpoint = await this.get(tenantId, id);
    const issues: string[] = [];
    if (!endpoint.enabled) issues.push('Endpoint is disabled');
    if (endpoint.credentialReferenceId && !endpoint.credential) issues.push('Configured credential reference could not be resolved');
    if (endpoint.credential && endpoint.credential.status !== 'ACTIVE') issues.push(`Credential status is ${endpoint.credential.status}`);
    if (endpoint.credential && endpoint.credential.environment !== endpoint.environment) {
      issues.push(`Credential environment (${endpoint.credential.environment}) does not match endpoint environment (${endpoint.environment})`);
    }
    if (endpoint.environment === 'PRODUCTION' && !endpoint.credentialReferenceId && endpoint.direction !== 'OUTBOUND') {
      issues.push('Production endpoint has no credential reference configured');
    }
    return { ok: issues.length === 0, issues };
  }
}
