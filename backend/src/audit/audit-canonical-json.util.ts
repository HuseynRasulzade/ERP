/**
 * Deterministic JSON serialization for audit hashing (docx spec Phase
 * 25, sections 81-82). Postgres `jsonb` storage does not guarantee
 * object key order is preserved across a write/read round-trip, so
 * hashing `JSON.stringify(value)` directly would make
 * `AuditIntegrityService.verify` report a false-positive tamper
 * whenever a legitimately untouched event's JSON columns simply come
 * back with keys in a different order than they were inserted with.
 * `canonicalJson` recursively sorts object keys before stringifying so
 * the SAME logical value always hashes to the SAME digest, at write
 * time and at every later verification, regardless of storage
 * round-trip reordering.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
