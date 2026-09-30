import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * LeaveBalanceService — reads/writes the append-only
 * `LeaveBalanceMovement` ledger (same Truth-Engine convention as
 * InventoryCostMovement/RegisterMovement elsewhere in this codebase).
 * `Employment` never carries a mutable balance field; the balance as of
 * any date is always the running sum of movements up to and including
 * that date. Scoped to ANNUAL leave only.
 */
@Injectable()
export class LeaveBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** The running ANNUAL-leave balance for `employmentId` as of `asOfDate`
   * (inclusive) — the sum of every movement dated on or before it. */
  async getBalance(tenantId: string, employmentId: string, asOfDate: Date, tx?: PrismaTransactionClient): Promise<Decimal> {
    const client = tx ?? this.prisma;
    const result = await client.leaveBalanceMovement.aggregate({
      where: { tenantId, employmentId, effectiveDate: { lte: asOfDate } },
      _sum: { quantityDays: true },
    });
    return new Decimal(result._sum.quantityDays?.toString() ?? '0');
  }

  async listMovements(tenantId: string, membershipId: string, organizationId: string, employmentId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.leaveBalanceMovement.findMany({
      where: { tenantId, employmentId },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Access-checked current balance, defaulting `asOfDate` to today. */
  async getCurrentBalance(tenantId: string, membershipId: string, organizationId: string, employmentId: string, asOfDate?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const date = asOfDate ? new Date(asOfDate) : new Date();
    const balance = await this.getBalance(tenantId, employmentId, date);
    return { employmentId, asOfDate: date.toISOString().slice(0, 10), balanceDays: balance.toFixed(2) };
  }

  async recordMovement(
    tenantId: string,
    input: {
      employmentId: string;
      movementType: 'ACCRUAL' | 'CONSUMPTION' | 'ADJUSTMENT';
      quantityDays: Decimal;
      effectiveDate: Date;
      sourceDocumentType?: string;
      sourceDocumentId?: string;
      userId: string;
    },
    tx: PrismaTransactionClient,
  ) {
    return tx.leaveBalanceMovement.create({
      data: {
        tenantId,
        employmentId: input.employmentId,
        movementType: input.movementType,
        quantityDays: input.quantityDays,
        effectiveDate: input.effectiveDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        createdBy: input.userId,
      },
    });
  }
}
