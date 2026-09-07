import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError } from '../common/errors/app-error';

/**
 * Idempotency infrastructure (section 36) — for API/integration operations
 * (bank import, webhooks, payment processing, repeated client requests),
 * not forced onto every internal CRUD call.
 *
 * Usage: `withIdempotency(tenantId, key, operation, payload, () => ...)`.
 * A repeated call with the same (tenant, key, operation) and an identical
 * payload replays the stored result; the same key with a *different*
 * payload is rejected as a conflict (the key was not meant to be reused
 * for a different request).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async withIdempotency<T>(
    tenantId: string | null,
    key: string,
    operation: string,
    payload: unknown,
    execute: () => Promise<T>,
  ): Promise<T> {
    const requestHash = this.hash(payload);

    // findFirst rather than findUnique/upsert: Prisma's compound-unique
    // `where` input rejects an explicit null for `tenantId`, which a
    // platform-level (non-tenant) operation legitimately has.
    const existing = await this.prisma.idempotencyKey.findFirst({
      where: { tenantId, key, operation },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictAppError('Idempotency key reused with a different request payload');
      }
      if (existing.status === 'COMPLETED') {
        return existing.responseBody as T;
      }
      if (existing.status === 'IN_PROGRESS') {
        throw new ConflictAppError('An operation with this idempotency key is already in progress');
      }
    }

    const record = existing
      ? await this.prisma.idempotencyKey.update({
          where: { id: existing.id },
          data: { requestHash, status: 'IN_PROGRESS', responseBody: undefined },
        })
      : await this.prisma.idempotencyKey.create({
          data: { tenantId, key, operation, requestHash, status: 'IN_PROGRESS' },
        });

    try {
      const result = await execute();
      await this.prisma.idempotencyKey.update({
        where: { id: record.id },
        data: { status: 'COMPLETED', responseBody: result as any },
      });
      return result;
    } catch (error) {
      await this.prisma.idempotencyKey.update({
        where: { id: record.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  private hash(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
  }
}
