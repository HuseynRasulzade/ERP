/**
 * `JSON.stringify` has no native BigInt support, and Postgres-native
 * autoincrement columns (AccountingMovement.postingSequence) come back
 * from Prisma as `bigint`. Imported once from AppModule (so both the real
 * server bootstrap and every e2e TestingModule pick it up) rather than
 * hand-converting every response DTO that might carry one.
 */
if (typeof (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON !== 'function') {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value(this: bigint) {
      return this.toString();
    },
  });
}
