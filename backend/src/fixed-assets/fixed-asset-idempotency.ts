import { IdempotencyService } from '../idempotency/idempotency.service';

/**
 * Optional client-side idempotency for fixed-asset commands (spec section
 * 129): when the caller sends an `Idempotency-Key` header, a retried
 * command with the same key and payload replays the stored result instead
 * of creating a second asset / movement. Without a key the command runs
 * normally (domain-level guards — locked candidate status, unique posted
 * depreciation key — still prevent double consumption).
 */
export function withOptionalIdempotency<T>(
  idempotency: IdempotencyService,
  tenantId: string,
  key: string | undefined,
  operation: string,
  payload: unknown,
  run: () => Promise<T>,
): Promise<T> {
  if (!key) return run();
  return idempotency.withIdempotency(tenantId, key, operation, payload, run);
}
