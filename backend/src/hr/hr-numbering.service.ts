import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';

/** HR number sequences, auto-provisioned per tenant on first use (the same
 * pattern every other module uses — EXTENDING.md step 3). All allocation
 * goes through the Phase 0 row-locking NumberingService (spec 7). */
const SEQUENCES: Record<string, { prefix: string; resetPolicy: 'NEVER' | 'YEARLY' }> = {
  HR_EMPLOYEE: { prefix: 'EMP', resetPolicy: 'NEVER' },
  HR_HIRE: { prefix: 'HIRE', resetPolicy: 'YEARLY' },
  HR_TRANSFER: { prefix: 'TRF', resetPolicy: 'YEARLY' },
  HR_TERMINATION: { prefix: 'TRM', resetPolicy: 'YEARLY' },
  HR_CONTRACT: { prefix: 'EC', resetPolicy: 'YEARLY' },
  HR_BULK_TRANSFER: { prefix: 'BTRF', resetPolicy: 'YEARLY' },
};

@Injectable()
export class HrNumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async ensure(tenantId: string, code: keyof typeof SEQUENCES) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (existing) return;
    const cfg = SEQUENCES[code];
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code, documentType: code, prefix: cfg.prefix, padding: 6, resetPolicy: cfg.resetPolicy } });
    } catch {
      // Lost the race to provision the sequence — fine.
    }
  }

  /** Call `ensure` BEFORE opening the transaction that allocates. */
  async next(tx: PrismaTransactionClient, tenantId: string, code: keyof typeof SEQUENCES, businessDate: Date) {
    return (await this.numbering.allocateNumber(tenantId, code, businessDate, tx)).formatted;
  }
}
