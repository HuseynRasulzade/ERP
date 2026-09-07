import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * TransactionManager / UnitOfWork (section 35, 70).
 *
 * All critical multi-write operations (posting, unposting, create-based-on +
 * link, sequence allocation, period close/reopen) must go through
 * `runInTransaction` rather than issuing ad-hoc commits from repositories.
 * Nothing outside the application/use-case layer should call
 * `prisma.$transaction` directly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async runInTransaction<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction((tx) => fn(tx), {
      // Posting/unposting must not see phantom reads of concurrently
      // allocated sequences or concurrently posted movements.
      isolationLevel: 'ReadCommitted',
      maxWait: 10_000,
      timeout: 20_000,
    });
  }
}

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
