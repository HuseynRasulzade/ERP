import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ApprovalStepType } from '../approvals/approval-plan.interface';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';

export interface UpsertApprovalRuleInput {
  organizationId?: string;
  category?: string;
  minAmount: number;
  maxAmount?: number;
  stepType: ApprovalStepType;
  sequence: number;
}

/** Configurable amount-tier approval ladder CRUD (spec sections 11-13) —
 * see PaymentRequestApprovalPlanProvider for how these rows are read. */
@Injectable()
export class TreasuryApprovalRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.treasuryPaymentApprovalRule.findMany({
          where: {
            tenantId,
            OR: [{ organizationId }, { organizationId: null }],
          },
          orderBy: [{ sequence: 'asc' }],
        }),
      );
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: UpsertApprovalRuleInput,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const minAmount = new Decimal(dto.minAmount.toString());
    if (minAmount.isNegative())
      throw new ValidationAppError('minAmount cannot be negative');
    if (
      dto.maxAmount != null &&
      new Decimal(dto.maxAmount.toString()).lt(minAmount)
    )
      throw new ValidationAppError('maxAmount must be >= minAmount');

    const created = await this.prisma.treasuryPaymentApprovalRule.create({
      data: {
        tenantId,
        organizationId: dto.organizationId ?? organizationId,
        category: dto.category,
        minAmount,
        maxAmount:
          dto.maxAmount != null
            ? new Decimal(dto.maxAmount.toString())
            : undefined,
        stepType: dto.stepType,
        sequence: dto.sequence,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'TREASURY_APPROVAL_RULE_CREATED',
      entityType: 'TREASURY_PAYMENT_APPROVAL_RULE',
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: dto,
    });
    return created;
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.treasuryPaymentApprovalRule.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('TreasuryPaymentApprovalRule', id);
    await this.prisma.treasuryPaymentApprovalRule.update({
      where: { id },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    await this.audit.record({
      tenantId,
      eventType: 'TREASURY_APPROVAL_RULE_DEACTIVATED',
      entityType: 'TREASURY_PAYMENT_APPROVAL_RULE',
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.treasuryPaymentApprovalRule.findFirst({ where: { id } });
  }
}
