import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface AccountablePersonBalanceRow {
  personId: string;
  currencyId: string | null;
  issued: string;
  reported: string;
  returned: string;
  outstanding: string;
}

/**
 * AccountablePersonBalance (spec sections 27-32) — an employee's own
 * settlement dimension, mirroring Phase 13's SettlementOpenItem/
 * SettlementMovement principle exactly: `AccountablePersonMovement` is the
 * append-only source of truth, outstanding balance is always the live sum
 * of a person's own movements, never a mutable field.
 */
@Injectable()
export class AccountablePersonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** Records an advance/return/expense-report/reimbursement movement —
   * called by CashTransactionPostingHandler (EMPLOYEE_ADVANCE/
   * EMPLOYEE_ADVANCE_RETURN) inside its own posting transaction. */
  async recordMovement(
    tenantId: string,
    input: {
      organizationId: string;
      personId: string;
      currencyId: string | null;
      movementType: string;
      amount: Decimal;
      sourceDocumentType: string;
      sourceDocumentId: string;
      effectiveDate: Date;
      createdBy?: string;
    },
    tx: PrismaTransactionClient,
  ) {
    return tx.accountablePersonMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        personId: input.personId,
        currencyId: input.currencyId,
        movementType: input.movementType,
        amount: input.amount,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        effectiveDate: input.effectiveDate,
        createdBy: input.createdBy,
      },
    });
  }

  /** Symmetric reversal for unpost — removes every movement this
   * document's own posting created. */
  async reverseForDocument(
    tenantId: string,
    sourceDocumentType: string,
    sourceDocumentId: string,
    tx: PrismaTransactionClient,
  ) {
    await tx.accountablePersonMovement.deleteMany({
      where: { tenantId, sourceDocumentType, sourceDocumentId },
    });
  }

  async getBalance(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    personId: string,
  ): Promise<AccountablePersonBalanceRow[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const movements = await this.prisma.accountablePersonMovement.findMany({
      where: { tenantId, organizationId, personId },
    });
    return this.aggregate(movements).map((row) => ({ ...row, personId }));
  }

  /** Ageing report (spec section 32) — one row per person/currency,
   * oldest ADVANCE_ISSUED movement's own date as the ageing anchor. */
  async ageing(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    asOfDate: Date = new Date(),
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const movements = await this.prisma.accountablePersonMovement.findMany({
      where: { tenantId, organizationId },
      orderBy: { effectiveDate: 'asc' },
    });
    const byPerson = new Map<string, typeof movements>();
    for (const m of movements)
      byPerson.set(m.personId, [...(byPerson.get(m.personId) ?? []), m]);

    const rows: (AccountablePersonBalanceRow & {
      advanceDate: string | null;
      daysOutstanding: number;
    })[] = [];
    for (const [personId, personMovements] of byPerson) {
      for (const row of this.aggregate(personMovements)) {
        if (new Decimal(row.outstanding).abs().lte(0.005)) continue;
        const firstAdvance = personMovements.find(
          (m) =>
            m.movementType === 'ADVANCE_ISSUED' &&
            m.currencyId === row.currencyId,
        );
        const advanceDate = firstAdvance?.effectiveDate ?? null;
        rows.push({
          ...row,
          personId,
          advanceDate: advanceDate
            ? advanceDate.toISOString().slice(0, 10)
            : null,
          daysOutstanding: advanceDate
            ? Math.max(
                0,
                Math.floor(
                  (asOfDate.getTime() - advanceDate.getTime()) / 86_400_000,
                ),
              )
            : 0,
        });
      }
    }
    return rows;
  }

  private aggregate(
    movements: {
      currencyId: string | null;
      movementType: string;
      amount: any;
    }[],
  ): AccountablePersonBalanceRow[] {
    const byCurrency = new Map<
      string | null,
      { issued: Decimal; reported: Decimal; returned: Decimal }
    >();
    for (const m of movements) {
      const key = m.currencyId;
      const bucket = byCurrency.get(key) ?? {
        issued: new Decimal(0),
        reported: new Decimal(0),
        returned: new Decimal(0),
      };
      const amount = new Decimal(m.amount.toString());
      if (
        m.movementType === 'ADVANCE_ISSUED' ||
        m.movementType === 'ADDITIONAL_REIMBURSEMENT'
      )
        bucket.issued = bucket.issued.plus(amount);
      else if (m.movementType === 'RETURNED')
        bucket.returned = bucket.returned.plus(amount.abs());
      else if (m.movementType === 'EXPENSE_REPORTED')
        bucket.reported = bucket.reported.plus(amount.abs());
      byCurrency.set(key, bucket);
    }
    return Array.from(byCurrency.entries()).map(([currencyId, b]) => ({
      personId: '',
      currencyId,
      issued: b.issued.toFixed(2),
      reported: b.reported.toFixed(2),
      returned: b.returned.toFixed(2),
      outstanding: b.issued.minus(b.reported).minus(b.returned).toFixed(2),
    }));
  }
}
