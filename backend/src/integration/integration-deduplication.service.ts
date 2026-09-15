import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

export type DedupSignalType = 'EXTERNAL_DOCUMENT_NUMBER' | 'SUPPLIER_INVOICE_NO' | 'EVENT_HASH' | 'SOURCE_FILE_ROW' | 'BANK_TRANSACTION_ID' | 'RECEIPT_FINGERPRINT';
export type DedupResult = 'UNIQUE' | 'EXACT_DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'SUPERSEDING_VERSION' | 'CONFLICT';

/**
 * IntegrationDeduplicationService (docx spec Phase 28, sections 51-53).
 * Deliberately separate from `IdempotencyService` (spec section 51):
 * idempotency asks "was this EXACT operation already performed" (same
 * key => same result, enforced by `IdempotencyService.withIdempotency`);
 * deduplication asks "does a DIFFERENT message represent the SAME
 * external business object/event" (e.g. two different webhook payloads
 * both describing invoice INV-100). A message can be idempotency-unique
 * (never processed under that exact key before) and still be a
 * deduplication `POSSIBLE_DUPLICATE` of an earlier, differently-keyed
 * message.
 */
@Injectable()
export class IntegrationDeduplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    tenantId: string,
    messageId: string,
    signalType: DedupSignalType,
    signalValue: string,
    options: { versionField?: { previous: number; current: number } } = {},
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const priorHit = await client.integrationDeduplicationResult.findFirst({
      where: { tenantId, signalType, signalValue, result: { in: ['UNIQUE', 'SUPERSEDING_VERSION'] } },
      orderBy: { createdAt: 'desc' },
    });

    let result: DedupResult = 'UNIQUE';
    let matchedMessageId: string | undefined;

    if (priorHit) {
      matchedMessageId = priorHit.messageId;
      if (options.versionField) {
        // spec section 198 — "different event, same document" must NOT
        // be treated as an exact duplicate when the contract supports a
        // versioned update: a strictly higher version supersedes.
        result = options.versionField.current > options.versionField.previous ? 'SUPERSEDING_VERSION' : options.versionField.current === options.versionField.previous ? 'EXACT_DUPLICATE' : 'CONFLICT';
      } else {
        result = 'EXACT_DUPLICATE';
      }
    }

    const row = await client.integrationDeduplicationResult.create({
      data: { tenantId, messageId, signalType, signalValue, result, matchedMessageId },
    });
    return row;
  }
}
