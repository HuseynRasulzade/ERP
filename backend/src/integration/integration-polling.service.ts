import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * IntegrationPollingService (docx spec Phase 28, sections 80-82, 210-
 * 211). The cursor is persisted BEFORE processing each page completes
 * (spec section 210 — "crash after page 3, expected safe resume") and
 * `resumeCursor` returns a watermark ALREADY shifted back by
 * `overlapSeconds` (spec section 82 — provider eventual-consistency
 * overlap), so re-fetching a few already-seen records is expected and
 * relies on `IntegrationDeduplicationService`/idempotency downstream to
 * absorb them (spec section 211), never on the cursor being exact.
 */
@Injectable()
export class IntegrationPollingService {
  constructor(private readonly prisma: PrismaService) {}

  async getCursor(tenantId: string, endpointId: string, resource: string) {
    return this.prisma.integrationPollingCursor.findFirst({ where: { tenantId, endpointId, resource } });
  }

  /** Returns the watermark to poll FROM, with an overlap window
   * subtracted — never the raw last-successful timestamp. */
  async resumeWatermark(tenantId: string, endpointId: string, resource: string, overlapSeconds: number): Promise<Date | null> {
    const cursor = await this.getCursor(tenantId, endpointId, resource);
    if (!cursor?.watermark) return null;
    return new Date(cursor.watermark.getTime() - overlapSeconds * 1000);
  }

  async advance(tenantId: string, endpointId: string, resource: string, externalCursor: string | null, newWatermark: Date) {
    return this.prisma.integrationPollingCursor.upsert({
      where: { tenantId_endpointId_resource: { tenantId, endpointId, resource } },
      create: { tenantId, endpointId, resource, lastExternalCursor: externalCursor, watermark: newWatermark, lastTimestamp: newWatermark, lastSuccessfulPollAt: new Date() },
      update: { lastExternalCursor: externalCursor, watermark: newWatermark, lastTimestamp: newWatermark, lastSuccessfulPollAt: new Date() },
    });
  }

  async listStale(tenantId: string, staleAfterMinutes: number) {
    const threshold = new Date(Date.now() - staleAfterMinutes * 60_000);
    return this.prisma.integrationPollingCursor.findMany({ where: { tenantId, OR: [{ lastSuccessfulPollAt: null }, { lastSuccessfulPollAt: { lt: threshold } }] } });
  }
}
