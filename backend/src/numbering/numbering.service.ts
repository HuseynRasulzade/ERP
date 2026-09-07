import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface AllocatedNumber {
  sequenceId: string;
  formatted: string;
  rawNumber: bigint;
}

/**
 * Generic document/reference numbering service (section 15).
 *
 * Concurrency safety is achieved with a single atomic `UPDATE ... RETURNING`
 * against the sequence row (never `SELECT MAX(number) + 1`): Postgres takes
 * a row lock for the duration of the UPDATE, so concurrent allocators
 * serialize on that row and each one observes a strictly increasing,
 * unique `next_number` — with a DB uniqueness constraint on the formatted
 * document number as the final backstop (section 40).
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  async createSequence(
    tenantId: string,
    params: {
      code: string;
      documentType: string;
      prefix?: string;
      suffix?: string;
      padding?: number;
      resetPolicy?: 'NEVER' | 'YEARLY' | 'MONTHLY';
    },
  ) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: params.code } },
    });
    if (existing) throw new ConflictAppError(`Numbering sequence code already exists: ${params.code}`);

    return this.prisma.numberSequence.create({
      data: {
        tenantId,
        code: params.code,
        documentType: params.documentType,
        prefix: params.prefix ?? '',
        suffix: params.suffix ?? '',
        padding: params.padding ?? 6,
        resetPolicy: params.resetPolicy ?? 'NEVER',
      },
    });
  }

  listSequences(tenantId: string) {
    return this.prisma.numberSequence.findMany({ where: { tenantId } });
  }

  /**
   * Allocates the next number for `code` as of `businessDate`.
   *
   * Concurrency safety: `SELECT ... FOR UPDATE` takes a row lock on the
   * sequence row for the remainder of the transaction, so a second
   * concurrent allocator blocks at the SELECT until the first commits (or
   * rolls back) rather than both reading the same "next_number" and racing
   * to write it back — the classic `SELECT MAX(number) + 1` failure mode.
   *
   * Pass `tx` when invoked as part of a larger posting/save transaction so
   * a rollback of the outer operation also rolls back the allocation.
   * Without `tx`, the lock+update is wrapped in its own transaction here.
   */
  async allocateNumber(
    tenantId: string,
    code: string,
    businessDate: Date,
    tx?: PrismaTransactionClient,
  ): Promise<AllocatedNumber> {
    const run = async (client: PrismaTransactionClient) => {
      const rows = await client.$queryRawUnsafe<
        {
          id: string;
          prefix: string;
          suffix: string | null;
          padding: number;
          next_number: bigint;
          reset_policy: string;
          current_year: number | null;
          current_month: number | null;
          active: boolean;
        }[]
      >(
        `SELECT id, prefix, suffix, padding, next_number, reset_policy, current_year, current_month, active
         FROM number_sequences
         WHERE tenant_id = $1 AND code = $2
         FOR UPDATE`,
        tenantId,
        code,
      );

      const sequence = rows[0];
      if (!sequence) throw new NotFoundAppError('NumberSequence', code);
      if (!sequence.active) throw new ValidationAppError(`Numbering sequence is inactive: ${code}`);

      const year = businessDate.getUTCFullYear();
      const month = businessDate.getUTCMonth() + 1;

      const needsReset =
        (sequence.reset_policy === 'YEARLY' && sequence.current_year !== year) ||
        (sequence.reset_policy === 'MONTHLY' &&
          (sequence.current_year !== year || sequence.current_month !== month));

      const allocated = needsReset ? 1n : sequence.next_number;
      const nextStored = allocated + 1n;

      await client.$executeRawUnsafe(
        `UPDATE number_sequences SET next_number = $1, current_year = $2, current_month = $3 WHERE id = $4`,
        nextStored,
        year,
        month,
        sequence.id,
      );

      const formatted = this.format(sequence, year, allocated);
      return { sequenceId: sequence.id, formatted, rawNumber: allocated };
    };

    if (tx) return run(tx);
    return this.prisma.runInTransaction((prismaTx) => run(prismaTx));
  }

  private format(
    sequence: { prefix: string; suffix: string | null; padding: number },
    year: number,
    n: bigint,
  ): string {
    const padded = n.toString().padStart(sequence.padding, '0');
    const parts = [sequence.prefix, String(year), padded].filter((p) => p !== '');
    return parts.join('-') + (sequence.suffix ?? '');
  }
}
