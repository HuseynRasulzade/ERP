import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const SEQUENCE_PREFIX = 'PR';
const REQUEST_TYPE = 'PAYMENT_REQUEST';

/**
 * PaymentRequestService (spec sections 4-10). Layer 1 only — creating or
 * even approving a request NEVER touches bank balance or AR/AP (spec
 * section 6's own architectural rule); `status` transitions here are
 * request-lifecycle only, `paidAmount`/final `PAID` status are owned
 * exclusively by `SettlementPaymentPostingHandler` (spec section 7).
 */
@Injectable()
export class PaymentRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, status?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.paymentRequest.findMany({ where: { organizationId, status }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.paymentRequest.findFirst({ where: { id, organizationId }, include: { approvals: true } });
    if (!row) throw new NotFoundAppError('PaymentRequest', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { requestDate: string; requestedPaymentDate?: string; paymentPriority?: string; paymentCategory?: string; counterpartyId?: string; contractId?: string; bankAccountId?: string; currencyId: string; requestedAmount: number; paymentPurpose?: string; sourceDocumentType?: string; sourceDocumentId?: string; sourceOpenItemId?: string; responsibleUserId?: string; comment?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.requestedAmount <= 0) throw new ValidationAppError('Requested amount must be positive');
    const requestDate = this.parseDate(dto.requestDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, REQUEST_TYPE, requestDate, tx);
      const row = await tx.paymentRequest.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          requestDate,
          requestedPaymentDate: dto.requestedPaymentDate ? new Date(dto.requestedPaymentDate) : undefined,
          paymentPriority: dto.paymentPriority ?? 'NORMAL',
          paymentCategory: dto.paymentCategory ?? 'SUPPLIER',
          counterpartyId: dto.counterpartyId,
          contractId: dto.contractId,
          bankAccountId: dto.bankAccountId,
          currencyId: dto.currencyId,
          requestedAmount: dto.requestedAmount.toString(),
          paymentPurpose: dto.paymentPurpose,
          sourceDocumentType: dto.sourceDocumentType,
          sourceDocumentId: dto.sourceDocumentId,
          sourceOpenItemId: dto.sourceOpenItemId,
          requestedBy: userId,
          responsibleUserId: dto.responsibleUserId,
          status: 'DRAFT',
          comment: dto.comment,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_REQUEST_CREATED', entityType: REQUEST_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { number: row.number, requestedAmount: dto.requestedAmount } }, tx);
      return row;
    });
  }

  async submit(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const request = await this.getOrThrow(tenantId, organizationId, id);
    if (request.status !== 'DRAFT') throw new ValidationAppError(`Cannot submit a request in status ${request.status}`);
    return this.prisma.paymentRequest.update({ where: { id }, data: { status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' } });
  }

  async cancel(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const request = await this.getOrThrow(tenantId, organizationId, id);
    if (new Decimal(request.paidAmount.toString()).gt(0)) {
      throw new ValidationAppError('Cannot cancel a request that has already been (partially) paid — cancel only the remaining unpaid approved amount instead');
    }
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.paymentRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.paymentCalendarItem.deleteMany({ where: { tenantId, paymentRequestId: id, executedAmount: 0 } });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_REQUEST_REJECTED', entityType: REQUEST_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { status: 'CANCELLED' } }, tx);
      return updated;
    });
  }

  async getOrThrow(tenantId: string, organizationId: string, id: string) {
    const row = await this.prisma.paymentRequest.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('PaymentRequest', id);
    return row;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: REQUEST_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: REQUEST_TYPE, documentType: REQUEST_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
