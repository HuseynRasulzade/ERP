import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { calculateCreditCheck } from './credit-check.util';

export interface CreditCheckResult {
  status: 'NOT_CHECKED' | 'WITHIN_LIMIT' | 'APPROVAL_REQUIRED' | 'BLOCKED';
  creditLimit: string | null;
  currentExposure: null; // spec section 55: no AR data source exists yet (Phase 13) — never fabricated
  newOrderExposure: string;
  projectedExposure: string;
  availableLimit: string | null;
  actionPolicy: 'NONE' | 'REQUIRE_APPROVAL' | 'BLOCK';
  explanation: string;
}

/**
 * CreditCheckService (spec sections 54-58) — a deliberately narrow
 * contract. `currentExposure` is always `null`: this codebase has no AR/
 * settlement module (Phase 13) to source it from, and the spec explicitly
 * forbids fabricating one ("do not persist fake values where data source
 * does not yet exist"). Today's check is therefore: does the NEW order
 * amount alone exceed the counterparty's configured credit limit — not a
 * true exposure check. `projectedExposure` reflects that (it equals
 * `newOrderExposure`) rather than pretending to include existing debt.
 * The threshold math itself lives in `credit-check.util.ts` so
 * `SalesOrderApprovalPlanProvider` runs the exact same calculation at
 * create time (inside the creation transaction) that this service runs
 * again at posting time.
 */
@Injectable()
export class CreditCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string, counterpartyId: string, orderAmount: Decimal): Promise<CreditCheckResult> {
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId, tenantId } });
    if (!counterparty) throw new NotFoundAppError('Counterparty', counterpartyId);

    const limit = counterparty.creditLimit ? new Decimal(counterparty.creditLimit.toString()) : null;
    const calc = calculateCreditCheck(limit, orderAmount);

    return {
      status: calc.status,
      creditLimit: limit ? limit.toFixed(2) : null,
      currentExposure: null,
      newOrderExposure: orderAmount.toFixed(2),
      projectedExposure: orderAmount.toFixed(2),
      availableLimit: limit ? limit.minus(orderAmount).toFixed(2) : null,
      actionPolicy: calc.actionPolicy,
      explanation: calc.explanation,
    };
  }
}
