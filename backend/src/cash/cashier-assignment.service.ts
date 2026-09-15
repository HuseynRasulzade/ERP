import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * CashierAssignmentService (spec sections 6-7). Enforced by
 * `SettlementPaymentPostingHandler` (spec section 116's own error
 * example) — this service only manages the assignment records themselves.
 */
@Injectable()
export class CashierAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async assign(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { cashDeskId: string; assignedUserId: string; validFrom: string; validTo?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.cashierAssignment.create({ data: { tenantId, cashDeskId: dto.cashDeskId, userId: dto.assignedUserId, validFrom: new Date(dto.validFrom), validTo: dto.validTo ? new Date(dto.validTo) : undefined, status: 'ACTIVE', createdBy: userId } });
      await this.audit.record({ tenantId, eventType: 'CASHIER_ASSIGNED', entityType: 'CASHIER_ASSIGNMENT', entityId: row.id, action: 'CREATE', userId, newValues: { cashDeskId: dto.cashDeskId, userId: dto.assignedUserId } }, tx);
      return row;
    });
  }

  async end(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.cashierAssignment.findFirst({ where: { id, tenantId } });
    if (!row) throw new ValidationAppError('Assignment not found');
    return this.prisma.cashierAssignment.update({ where: { id }, data: { status: 'ENDED', validTo: new Date() } });
  }

  list(tenantId: string, cashDeskId?: string, userId?: string) {
    return this.prisma.cashierAssignment.findMany({ where: { tenantId, cashDeskId, userId, status: 'ACTIVE' } });
  }
}
