import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalAuthorityService } from './approval-authority.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * DelegationService (docx spec Phase 26, sections 35-38). A delegation
 * can never grant MORE than the delegator's own authority (spec section
 * 36's own "Delegation cannot bypass ... amount limits") — `resolveDelegate`
 * checks the delegate's own authority (if the delegation defines a
 * `maxAmount`, that value itself is validated against the document
 * amount before the delegate is substituted). No delegation-of-a-
 * delegation chain is followed — depth is capped at 1 (spec section 38's
 * own "avoid unlimited chains"), disclosed as this build's fixed policy
 * rather than a configurable max-depth.
 */
@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: ApprovalAuthorityService,
  ) {}

  async create(tenantId: string, dto: { delegatorUserId: string; delegateUserId: string; validFrom: string; validTo?: string; workflowCategory?: string; organizationId?: string; maxAmount?: number; allowedActions?: string[] }) {
    if (dto.delegatorUserId === dto.delegateUserId) throw new ValidationAppError('A user cannot delegate to themselves');
    return this.prisma.delegationRule.create({ data: { tenantId, delegatorUserId: dto.delegatorUserId, delegateUserId: dto.delegateUserId, validFrom: new Date(dto.validFrom), validTo: dto.validTo ? new Date(dto.validTo) : undefined, workflowCategory: dto.workflowCategory, organizationId: dto.organizationId, maxAmount: dto.maxAmount, allowedActions: dto.allowedActions as object | undefined, status: 'ACTIVE' } });
  }

  async revoke(tenantId: string, id: string) {
    return this.prisma.delegationRule.updateMany({ where: { id, tenantId }, data: { status: 'REVOKED' } });
  }

  /** Returns the delegate to substitute for `delegatorUserId` on this
   * date/category/amount, or null if no active, in-scope, in-authority
   * delegation exists (the original approver stays assigned). Depth is
   * fixed at one hop — a delegate's own further delegation is not
   * followed. */
  async resolveDelegate(tenantId: string, delegatorUserId: string, context: { asOfDate: Date; workflowCategory?: string; organizationId: string; amount: Decimal.Value; currencyId: string }): Promise<string | null> {
    const delegation = await this.prisma.delegationRule.findFirst({
      where: {
        tenantId,
        delegatorUserId,
        status: 'ACTIVE',
        validFrom: { lte: context.asOfDate },
        OR: [{ validTo: null }, { validTo: { gte: context.asOfDate } }],
        AND: [{ OR: [{ workflowCategory: context.workflowCategory }, { workflowCategory: null }] }, { OR: [{ organizationId: context.organizationId }, { organizationId: null }] }],
      },
    });
    if (!delegation) return null;

    if (delegation.maxAmount !== null && new Decimal(context.amount).gt(delegation.maxAmount.toString())) {
      return null; // delegation exists but amount exceeds its own limit (spec section 191) — original approver stays assigned, blocking if unresolvable elsewhere
    }

    // The delegation itself cannot grant more than the DELEGATE's own
    // configured authority either (spec section 36).
    const delegateAuthority = await this.authority.check(tenantId, delegation.delegateUserId, { workflowCategory: context.workflowCategory, organizationId: context.organizationId, amount: context.amount, currencyId: context.currencyId, businessDate: context.asOfDate });
    if (!delegateAuthority.authorized) return null;

    return delegation.delegateUserId;
  }
}
