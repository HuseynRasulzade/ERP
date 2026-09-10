import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface CreditCheckResult {
  status: 'NOT_CHECKED' | 'WITHIN_LIMIT' | 'WARNING' | 'BLOCKED' | 'APPROVAL_REQUIRED';
  creditLimit: string | null;
  currentExposure: null; // spec section 55: no AR data source exists yet (Phase 13) — never fabricated
  newOrderExposure: string;
  projectedExposure: string;
  availableLimit: string | null;
  actionPolicy: 'NONE' | 'WARN' | 'BLOCK' | 'REQUIRE_APPROVAL';
  explanation: string;
}

const WARNING_GRACE_PERCENT = 10;

/**
 * CreditCheckService (spec sections 54-58) — a deliberately narrow
 * contract. `currentExposure` is always `null`: this codebase has no AR/
 * settlement module (Phase 13) to source it from, and the spec explicitly
 * forbids fabricating one ("do not persist fake values where data source
 * does not yet exist"). Today's check is therefore: does the NEW order
 * amount alone exceed the counterparty's configured credit limit — not a
 * true exposure check. `projectedExposure` reflects that (it equals
 * `newOrderExposure`) rather than pretending to include existing debt.
 */
@Injectable()
export class CreditCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string, counterpartyId: string, orderAmount: Decimal): Promise<CreditCheckResult> {
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId, tenantId } });
    if (!counterparty) throw new NotFoundAppError('Counterparty', counterpartyId);

    if (!counterparty.creditLimit) {
      return {
        status: 'NOT_CHECKED',
        creditLimit: null,
        currentExposure: null,
        newOrderExposure: orderAmount.toFixed(2),
        projectedExposure: orderAmount.toFixed(2),
        availableLimit: null,
        actionPolicy: 'NONE',
        explanation: 'No credit limit configured for this counterparty — nothing to check against.',
      };
    }

    const limit = new Decimal(counterparty.creditLimit.toString());
    const availableLimit = limit.minus(orderAmount);
    const warningThreshold = limit.mul(1 + WARNING_GRACE_PERCENT / 100);

    let status: CreditCheckResult['status'];
    let actionPolicy: CreditCheckResult['actionPolicy'];
    let explanation: string;
    if (orderAmount.lte(limit)) {
      status = 'WITHIN_LIMIT';
      actionPolicy = 'NONE';
      explanation = `Order amount ${orderAmount.toFixed(2)} is within the configured credit limit ${limit.toFixed(2)}.`;
    } else if (orderAmount.lte(warningThreshold)) {
      status = 'WARNING';
      actionPolicy = 'WARN';
      explanation = `Order amount ${orderAmount.toFixed(2)} exceeds the credit limit ${limit.toFixed(2)} but is within the ${WARNING_GRACE_PERCENT}% warning threshold.`;
    } else {
      status = 'BLOCKED';
      actionPolicy = 'BLOCK';
      explanation = `Order amount ${orderAmount.toFixed(2)} exceeds the credit limit ${limit.toFixed(2)} beyond the warning threshold.`;
    }

    return {
      status,
      creditLimit: limit.toFixed(2),
      currentExposure: null,
      newOrderExposure: orderAmount.toFixed(2),
      projectedExposure: orderAmount.toFixed(2),
      availableLimit: availableLimit.toFixed(2),
      actionPolicy,
      explanation,
    };
  }
}
