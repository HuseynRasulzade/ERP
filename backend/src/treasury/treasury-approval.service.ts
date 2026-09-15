import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RbacService } from '../rbac/rbac.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PaymentCalendarService } from './payment-calendar.service';

/**
 * TreasuryApprovalService (spec sections 11-13). A basic, configurable
 * threshold engine — NOT Phase 26's full workflow (delegation, escalation,
 * multi-step routing). Rules are evaluated in ascending `minAmount` order;
 * the requesting user's held permissions are checked against the winning
 * rule's `requiredPermissionCodes` (ALL required). Approval history is
 * append-only (`PaymentApproval` rows, never edited).
 */
@Injectable()
export class TreasuryApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly rbac: RbacService,
    private readonly calendar: PaymentCalendarService,
  ) {}

  async resolveRule(tenantId: string, organizationId: string, paymentCategory: string, amount: Decimal) {
    const rules = await this.prisma.treasuryApprovalRule.findMany({ where: { tenantId, organizationId, active: true }, orderBy: { minAmount: 'asc' } });
    const matching = rules.filter((r) => (r.paymentCategory == null || r.paymentCategory === paymentCategory) && amount.gte(r.minAmount.toString()) && (r.maxAmount == null || amount.lt(r.maxAmount.toString())));
    return matching[0] ?? null; // most specific/lowest-threshold match
  }

  async createRule(tenantId: string, organizationId: string, userId: string, dto: { paymentCategory?: string; minAmount: number; maxAmount?: number; requiredPermissionCodes: string[]; approvalLevel?: number }) {
    return this.prisma.treasuryApprovalRule.create({
      data: { tenantId, organizationId, paymentCategory: dto.paymentCategory, minAmount: dto.minAmount.toString(), maxAmount: dto.maxAmount?.toString(), requiredPermissionCodes: dto.requiredPermissionCodes.join(','), approvalLevel: dto.approvalLevel ?? 1 },
    });
  }

  async approve(tenantId: string, membershipId: string, organizationId: string, userId: string, requestId: string, approvedAmount: number, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const request = await this.prisma.paymentRequest.findFirst({ where: { id: requestId, tenantId, organizationId } });
    if (!request) throw new NotFoundAppError('PaymentRequest', requestId);
    if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(request.status)) throw new ValidationAppError(`Cannot approve a request in status ${request.status}`);

    const rule = await this.resolveRule(tenantId, organizationId, request.paymentCategory, new Decimal(request.requestedAmount.toString()));
    if (rule) {
      const requiredCodes = rule.requiredPermissionCodes.split(',').map((c) => c.trim());
      const permissions = new Set(await this.rbac.effectivePermissions(membershipId));
      const missing = requiredCodes.filter((c) => !permissions.has(c));
      if (missing.length > 0) throw new ValidationAppError(`Approving this payment request requires: ${missing.join(', ')}`);
    }

    if (approvedAmount <= 0 || approvedAmount > Number(request.requestedAmount.toString()) + 0.01) {
      throw new ValidationAppError('Approved amount must be positive and cannot exceed the requested amount');
    }

    return this.prisma.runInTransaction(async (tx) => {
      await tx.paymentApproval.create({ data: { tenantId, paymentRequestId: requestId, approverUserId: userId, approvedAmount: approvedAmount.toString(), decision: approvedAmount >= Number(request.requestedAmount.toString()) - 0.01 ? 'APPROVED' : 'PARTIALLY_APPROVED', level: rule?.approvalLevel ?? 1, comment } });
      const status = approvedAmount >= Number(request.requestedAmount.toString()) - 0.01 ? 'APPROVED' : 'PARTIALLY_APPROVED';
      const updated = await tx.paymentRequest.update({ where: { id: requestId }, data: { approvedAmount: approvedAmount.toString(), status, approvalStatus: status, treasuryStatus: 'PLANNED' } });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_REQUEST_APPROVED', entityType: 'PAYMENT_REQUEST', entityId: requestId, action: 'UPDATE', userId, newValues: { approvedAmount, status } }, tx);
      await this.calendar.createFromApprovedRequest(tenantId, organizationId, { ...updated, approvedAmount: updated.approvedAmount.toString() });
      return updated;
    });
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, userId: string, requestId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      await tx.paymentApproval.create({ data: { tenantId, paymentRequestId: requestId, approverUserId: userId, decision: 'REJECTED', comment } });
      const updated = await tx.paymentRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', approvalStatus: 'REJECTED' } });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_REQUEST_REJECTED', entityType: 'PAYMENT_REQUEST', entityId: requestId, action: 'UPDATE', userId, newValues: { status: 'REJECTED' } }, tx);
      return updated;
    });
  }
}
