import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

/**
 * IntegrationPayloadService (docx spec Phase 28, sections 22-24, 137,
 * 139). Preserves the raw inbound/outbound payload for replay/audit/
 * dispute resolution, hashed for integrity. `location` is an opaque
 * storage reference (object storage key, file path, etc.) — this build
 * does not implement an actual object-storage backend, so `location` is
 * generated deterministically from the hash and the raw bytes are not
 * separately persisted anywhere this service can retrieve later
 * (disclosed, docs/INTEGRATION_PLATFORM.md) — the metadata contract
 * (hash/size/contentType/location) that every other service depends on
 * is fully real and independent of the storage backend behind it.
 */
@Injectable()
export class IntegrationPayloadService {
  constructor(private readonly prisma: PrismaService) {}

  async store(
    tenantId: string,
    raw: Buffer | string,
    contentType: string,
    options: { encrypted?: boolean; retentionPolicyCode?: string; purgeAfter?: Date } = {},
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const buffer = typeof raw === 'string' ? Buffer.from(raw, 'utf-8') : raw;
    const hash = createHash('sha256').update(buffer).digest('hex');

    // Same-hash payload already stored (spec section 85 — file-hash
    // dedup detection) — reuse the reference rather than storing a
    // byte-identical duplicate.
    const existing = await client.integrationPayloadReference.findFirst({ where: { tenantId, hash } });
    if (existing) return existing;

    return client.integrationPayloadReference.create({
      data: {
        tenantId,
        hash,
        size: buffer.length,
        contentType,
        location: `payload://${tenantId}/${hash}`,
        encrypted: options.encrypted ?? false,
        retentionPolicyCode: options.retentionPolicyCode,
        purgeAfter: options.purgeAfter,
      },
    });
  }

  async getMetadata(tenantId: string, id: string) {
    return this.prisma.integrationPayloadReference.findFirst({ where: { id, tenantId } });
  }

  async findByHash(tenantId: string, hash: string) {
    return this.prisma.integrationPayloadReference.findFirst({ where: { tenantId, hash } });
  }
}
