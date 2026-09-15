import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';

/**
 * A connector ADAPTER (spec sections 7-9) handles authentication,
 * transport, serialization, provider pagination/rate-limits/errors for
 * one connector family — never business rules (those stay in domain
 * services, called only through `IntegrationCommandRegistry`, Step 13).
 * `parse` turns a raw payload buffer into a plain JS object the schema
 * validator/mapper can work with; this build ships GENERIC_REST,
 * GENERIC_WEBHOOK and GENERIC_CSV adapters only (spec section 237 — a
 * framework plus minimum representative adapters, not every real
 * provider).
 */
export interface ConnectorAdapter {
  readonly connectorCode: string;
  parse(raw: Buffer | string, contentType: string): Record<string, unknown> | Record<string, unknown>[];
}

@Injectable()
export class IntegrationConnectorRegistry {
  private readonly adapters = new Map<string, ConnectorAdapter>();

  constructor(private readonly prisma: PrismaService) {}

  registerAdapter(adapter: ConnectorAdapter) {
    this.adapters.set(adapter.connectorCode, adapter);
  }

  getAdapter(connectorCode: string): ConnectorAdapter {
    const adapter = this.adapters.get(connectorCode);
    if (!adapter) throw new ValidationAppError(`No connector adapter registered for '${connectorCode}'`);
    return adapter;
  }

  list(tenantId: string) {
    return this.prisma.integrationConnector.findMany({ where: { tenantId }, include: { versions: true } });
  }

  async createConnector(tenantId: string, input: { code: string; name: string; family: string }) {
    return this.prisma.integrationConnector.create({ data: { tenantId, ...input } });
  }

  async createVersion(
    tenantId: string,
    connectorId: string,
    input: { effectiveFrom: Date; effectiveTo?: Date; implementationVersion: string; supportedContractVersions?: string[] },
  ) {
    const connector = await this.prisma.integrationConnector.findFirst({ where: { id: connectorId, tenantId } });
    if (!connector) throw new NotFoundAppError('IntegrationConnector', connectorId);
    const last = await this.prisma.integrationConnectorVersion.findFirst({ where: { tenantId, connectorId }, orderBy: { version: 'desc' } });
    return this.prisma.integrationConnectorVersion.create({
      data: {
        tenantId,
        connectorId,
        version: (last?.version ?? 0) + 1,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        implementationVersion: input.implementationVersion,
        supportedContractVersions: (input.supportedContractVersions ?? []) as object,
        status: 'DRAFT',
      },
    });
  }

  /** Migration lifecycle (spec sections 145-147): DRAFT -> TESTING ->
   * SHADOW -> ACTIVE, retiring the prior ACTIVE version for the same
   * connector. Shadow mode itself (processing without committing) is
   * enforced by callers checking `status === 'SHADOW'` before invoking
   * any domain command — this method only manages the state machine. */
  async promote(tenantId: string, versionId: string, toStatus: 'TESTING' | 'SHADOW' | 'ACTIVE') {
    const version = await this.prisma.integrationConnectorVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new NotFoundAppError('IntegrationConnectorVersion', versionId);
    if (version.status === 'RETIRED') throw new ConflictAppError(`Version ${versionId} is retired`);

    return this.prisma.runInTransaction(async (tx) => {
      if (toStatus === 'ACTIVE') {
        await tx.integrationConnectorVersion.updateMany({ where: { tenantId, connectorId: version.connectorId, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
      }
      return tx.integrationConnectorVersion.update({ where: { id: versionId }, data: { status: toStatus } });
    });
  }
}
