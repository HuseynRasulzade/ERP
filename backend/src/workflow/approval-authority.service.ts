import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';

export interface AuthorityCheckResult {
  authorized: boolean;
  maxAmount: string | null;
  amountInAuthorityCurrency: string;
}

/**
 * ApprovalAuthorityService (docx spec Phase 26, sections 98-100). A
 * role/rule match alone is insufficient if the document amount exceeds
 * the approver's own authority limit (spec section 99) — currency
 * comparisons always convert through `CurrencyService.resolveRate` at
 * the document's own business date (never today's rate for a
 * historical/backdated document, spec section 100).
 */
@Injectable()
export class ApprovalAuthorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async check(tenantId: string, userId: string, dto: { workflowCategory?: string; organizationId: string; amount: Decimal.Value; currencyId: string; businessDate: Date }): Promise<AuthorityCheckResult> {
    const authority = await this.prisma.approvalAuthority.findFirst({
      where: {
        tenantId,
        userId,
        effectiveFrom: { lte: dto.businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dto.businessDate } }],
        AND: [{ OR: [{ workflowCategory: dto.workflowCategory }, { workflowCategory: null }] }, { OR: [{ organizationId: dto.organizationId }, { organizationId: null }] }],
      },
      orderBy: { maxAmount: 'desc' }, // if multiple authority rows match, the most permissive wins
    });
    if (!authority) return { authorized: true, maxAmount: null, amountInAuthorityCurrency: new Decimal(dto.amount).toFixed(2) }; // no authority limit configured = unlimited (disclosed default)

    const amount = new Decimal(dto.amount);
    let amountInAuthorityCurrency = amount;
    if (authority.baseCurrencyId !== dto.currencyId) {
      const [documentCurrency, authorityCurrency] = await Promise.all([this.prisma.currency.findUniqueOrThrow({ where: { id: dto.currencyId } }), this.prisma.currency.findUniqueOrThrow({ where: { id: authority.baseCurrencyId } })]);
      const rate = await this.currency.resolveRate({ tenantId, currencyCode: documentCurrency.code, baseCurrencyCode: authorityCurrency.code, businessDate: dto.businessDate });
      amountInAuthorityCurrency = amount.mul(new Decimal(rate.rate.toString()));
    }

    return { authorized: amountInAuthorityCurrency.lte(authority.maxAmount.toString()), maxAmount: authority.maxAmount.toString(), amountInAuthorityCurrency: amountInAuthorityCurrency.toFixed(2) };
  }
}
