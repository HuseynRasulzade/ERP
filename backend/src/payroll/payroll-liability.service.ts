import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { DeductionCodes, EmployerContributionCodes } from './payroll-codes';

export const PAYROLL_LIABILITY_REGISTER = 'PAYROLL_LIABILITY_REGISTER';

/** Every liability category the register tracks — one per statutory
 * withholding/contribution plus NET_PAY itself (spec section 114: never
 * one lumped "payroll payable" bucket). */
export const LiabilityCategories = {
  NET_PAY: 'NET_PAY',
  ...DeductionCodes,
  ...EmployerContributionCodes,
} as const;
export type LiabilityCategory = (typeof LiabilityCategories)[keyof typeof LiabilityCategories];

const PAYMENT_ALLOCATION_TYPE = 'PAYROLL_PAYMENT_ALLOCATION';

/**
 * PayrollLiabilityService — the PAYROLL_LIABILITY_REGISTER (docx spec
 * Phase 19 sections 97-103, 114), reusing the generic RegisterMovement
 * ledger (the SIXTH reuse of this codebase's Truth Engine principle,
 * after Stock/Cash/Bank/FixedAsset/WorkTime). INCREASE movements are
 * written by PayrollPostingHandler.buildMovements when a period is
 * posted to the GL (via the document-framework, so they roll back
 * cleanly on unpost); DECREASE movements are written directly by this
 * service when a payment is recorded — a payment is never itself a GL
 * posting document in this build (that is Phase 14/15's own job), only a
 * register movement + a PayrollPaymentAllocation row.
 */
@Injectable()
export class PayrollLiabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pure computation (no writes) of the INCREASE movements a
   * PayrollCalculationResult's lines represent — handed to
   * DocumentPostingHandler.buildMovements, which DocumentPostingService
   * persists generically inside the posting transaction. */
  buildIncreaseMovements(
    result: {
      id: string;
      employmentId: string;
      net: Decimal | string;
      lines: Array<{ id: string; lineType: string; calculationCode: string; amount: Decimal | string }>;
    },
    dims: { organizationId: string; departmentId: string | null; payrollPeriodId: string },
    businessDate: Date,
  ): RegisterMovementInput[] {
    const movements: RegisterMovementInput[] = [];
    const net = new Decimal(result.net.toString());
    if (net.gt(0)) {
      movements.push({
        registerCode: PAYROLL_LIABILITY_REGISTER,
        recorderLineId: result.id,
        businessDate,
        movementType: LiabilityCategories.NET_PAY,
        dimensions: { employmentId: result.employmentId, category: LiabilityCategories.NET_PAY, ...dims },
        resources: { amount: net.toString(), direction: 'INCREASE' },
      });
    }
    for (const line of result.lines) {
      if (line.lineType !== 'DEDUCTION' && line.lineType !== 'EMPLOYER_CONTRIBUTION') continue;
      const amount = new Decimal(line.amount.toString());
      if (amount.lte(0)) continue;
      movements.push({
        registerCode: PAYROLL_LIABILITY_REGISTER,
        recorderLineId: line.id,
        businessDate,
        movementType: line.calculationCode,
        dimensions: { employmentId: result.employmentId, category: line.calculationCode, ...dims },
        resources: { amount: amount.toString(), direction: 'INCREASE' },
      });
    }
    return movements;
  }

  /** Outstanding balance for one employment/category = sum(INCREASE) -
   * sum(DECREASE) over the whole register (not scoped to one period —
   * an unpaid liability from an earlier period is still owed). */
  async getOutstandingBalance(
    tenantId: string,
    employmentId: string,
    category: string,
    tx?: PrismaTransactionClient,
  ): Promise<Decimal> {
    const client = tx ?? this.prisma;
    const movements = await client.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: PAYROLL_LIABILITY_REGISTER,
        movementType: category,
        dimensions: { path: ['employmentId'], equals: employmentId },
      },
    });
    return movements.reduce((sum, m) => {
      const resources = m.resources as { amount?: string; direction?: string } | null;
      const amount = new Decimal(resources?.amount ?? '0');
      return resources?.direction === 'DECREASE' ? sum.minus(amount) : sum.plus(amount);
    }, new Decimal(0));
  }

  /** Records a DECREASE against the register for an actual payment —
   * called directly by PayrollPaymentBatchService (not through the
   * document-framework: a payment allocation is a subledger movement,
   * not itself a GL-posting document in this build). */
  async recordDecrease(
    tenantId: string,
    tx: PrismaTransactionClient,
    params: {
      allocationId: string;
      employmentId: string;
      organizationId: string;
      payrollPeriodId: string;
      category: string;
      amount: Decimal;
      businessDate: Date;
    },
  ) {
    const sequence = await tx.registerMovement.count({
      where: { tenantId, registerCode: PAYROLL_LIABILITY_REGISTER, recorderDocumentType: PAYMENT_ALLOCATION_TYPE, recorderDocumentId: params.allocationId },
    });
    await tx.registerMovement.create({
      data: {
        tenantId,
        registerCode: PAYROLL_LIABILITY_REGISTER,
        recorderDocumentType: PAYMENT_ALLOCATION_TYPE,
        recorderDocumentId: params.allocationId,
        businessDate: params.businessDate,
        sequence: BigInt(sequence + 1),
        movementType: params.category,
        dimensions: {
          employmentId: params.employmentId,
          organizationId: params.organizationId,
          payrollPeriodId: params.payrollPeriodId,
          category: params.category,
        },
        resources: { amount: params.amount.toString(), direction: 'DECREASE' },
      },
    });
  }
}
