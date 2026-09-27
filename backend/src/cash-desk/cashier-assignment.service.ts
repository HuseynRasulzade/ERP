import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';

export interface AssignCashierInput {
  cashboxId: string;
  personId: string;
  validFrom: string;
  validTo?: string;
}

const ASSIGNMENT_TYPE = 'CASHIER_ASSIGNMENT';

/** CashierAssignment (spec section 6-7) — who may operate a cash desk,
 * within which date range. Multiple concurrent assignments to the same
 * cashbox are allowed (spec: "policy-yə görə ola bilər") — this build
 * does not enforce exclusivity, only existence. */
@Injectable()
export class CashierAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    cashboxId?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.cashierAssignment.findMany({
          where: { organizationId, ...(cashboxId ? { cashboxId } : {}) },
          orderBy: { validFrom: 'desc' },
        }),
      );
  }

  async assign(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    input: AssignCashierInput,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cashbox = await this.prisma.cashbox.findFirst({
      where: { id: input.cashboxId, organizationId },
    });
    if (!cashbox)
      throw new ValidationAppError(
        'Cashbox does not belong to this organization',
      );
    const person = await this.prisma.responsiblePerson.findFirst({
      where: { id: input.personId, tenantId },
    });
    if (!person)
      throw new ValidationAppError(
        'Responsible person does not belong to this tenant',
      );

    const validFrom = this.parseDate(input.validFrom);
    const validTo = input.validTo ? this.parseDate(input.validTo) : null;
    if (validTo && validTo < validFrom)
      throw new ValidationAppError('validTo must be on or after validFrom');

    const created = await this.prisma.cashierAssignment.create({
      data: {
        tenantId,
        organizationId,
        cashboxId: input.cashboxId,
        personId: input.personId,
        validFrom,
        validTo,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'CASHIER_ASSIGNED',
      entityType: ASSIGNMENT_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { cashboxId: input.cashboxId, personId: input.personId },
    });
    return created;
  }

  async end(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    endDate?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assignment = await this.prisma.cashierAssignment.findFirst({
      where: { id, organizationId },
    });
    if (!assignment) throw new NotFoundAppError('CashierAssignment', id);

    const result = await this.prisma.cashierAssignment.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        status: 'ENDED',
        validTo: endDate ? this.parseDate(endDate) : new Date(),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'CASHIER_ASSIGNMENT_ENDED',
      entityType: ASSIGNMENT_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.cashierAssignment.findFirst({ where: { id } });
  }

  /** Used by CashTransactionPostingHandler at posting time (spec section
   * 7: "cashier məsuliyyəti audit edilə bilməlidir"). */
  async hasActiveAssignment(
    tenantId: string,
    cashboxId: string,
    personId: string,
    asOfDate: Date,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const count = await client.cashierAssignment.count({
      where: {
        tenantId,
        cashboxId,
        personId,
        status: 'ACTIVE',
        validFrom: { lte: asOfDate },
        OR: [{ validTo: null }, { validTo: { gte: asOfDate } }],
      },
    });
    return count > 0;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
