import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';

export interface UpsertLiquidityPolicyInput {
  bankAccountId?: string;
  currencyId?: string;
  minimumBalance: number;
}

/** Minimum-cash-buffer policy CRUD (spec sections 20-21). */
@Injectable()
export class TreasuryLiquidityPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.treasuryLiquidityPolicy.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: UpsertLiquidityPolicyInput,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const minimumBalance = new Decimal(dto.minimumBalance.toString());
    if (minimumBalance.isNegative())
      throw new ValidationAppError('Minimum balance cannot be negative');

    const created = await this.prisma.treasuryLiquidityPolicy.create({
      data: {
        tenantId,
        organizationId,
        bankAccountId: dto.bankAccountId,
        currencyId: dto.currencyId,
        minimumBalance,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'TREASURY_LIQUIDITY_POLICY_CREATED',
      entityType: 'TREASURY_LIQUIDITY_POLICY',
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
    const row = await this.prisma.treasuryLiquidityPolicy.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('TreasuryLiquidityPolicy', id);
    await this.prisma.treasuryLiquidityPolicy.update({
      where: { id },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    await this.audit.record({
      tenantId,
      eventType: 'TREASURY_LIQUIDITY_POLICY_DEACTIVATED',
      entityType: 'TREASURY_LIQUIDITY_POLICY',
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.treasuryLiquidityPolicy.findFirst({ where: { id } });
  }
}
