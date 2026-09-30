import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { UpsertLeavePolicyDto } from './dto/hr-core.dto';

/**
 * LeavePolicyService — effective-dated ANNUAL leave entitlement policy per
 * organization, same `resolve(orgId, date)` / `upsert()` pattern as
 * `CostingPolicyService` (InventoryCostingPolicy is InventoryCostingModule's
 * own analogue). No policy configured for an organization/date is a
 * deliberate "accrual is not active here yet" state, never a fabricated
 * default — `LeaveAccrualRunService` simply skips an org with no resolvable
 * policy for the run's period.
 */
@Injectable()
export class LeavePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.leavePolicy.findMany({ where: { tenantId, organizationId }, orderBy: { effectiveFrom: 'desc' } });
  }

  /** Effective-dated resolve — the org's policy in force on `businessDate`,
   * or `null` when none has been configured yet. */
  async resolve(tenantId: string, organizationId: string, businessDate: Date, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.leavePolicy.findFirst({
      where: {
        tenantId,
        organizationId,
        status: 'ACTIVE',
        effectiveFrom: { lte: businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: businessDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** A rate change is a NEW effective-dated row, never an in-place mutation
   * of the current one — historical periods must keep accruing under the
   * rate that was active then. The previous open-ended row (if any) has its
   * `effectiveTo` closed off the day before the new one starts. */
  async upsert(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: UpsertLeavePolicyDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const effectiveFrom = this.parseDate(dto.effectiveFrom);
    const annualEntitlementDays = new Decimal(dto.annualEntitlementDays);
    if (!annualEntitlementDays.isFinite() || annualEntitlementDays.lte(0)) {
      throw new ValidationAppError('annualEntitlementDays must be positive');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const overlapping = await tx.leavePolicy.findFirst({
        where: { tenantId, organizationId, status: 'ACTIVE', effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (overlapping) {
        const dayBefore = new Date(effectiveFrom);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        if (dayBefore < overlapping.effectiveFrom) {
          throw new ValidationAppError('New leave policy effective date must be after the current policy started');
        }
        await tx.leavePolicy.update({ where: { id: overlapping.id }, data: { effectiveTo: dayBefore } });
      }

      const created = await tx.leavePolicy.create({
        data: { tenantId, organizationId, annualEntitlementDays, effectiveFrom, createdBy: userId },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_LEAVE_POLICY_CHANGED',
          entityType: 'LeavePolicy',
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { annualEntitlementDays: dto.annualEntitlementDays, effectiveFrom: dto.effectiveFrom },
          oldValues: overlapping ? { previousPolicyId: overlapping.id, previousAnnualEntitlementDays: overlapping.annualEntitlementDays.toString() } : undefined,
        },
        tx,
      );

      return created;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid effective date');
    return date;
  }
}
