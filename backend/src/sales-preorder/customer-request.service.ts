import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CUSTOMER_REQUEST_TYPE } from './customer-request.repository';
import { CreateCustomerRequestDto } from './dto/sales-preorder.dto';

const SEQUENCE_PREFIX = 'CR';
const CUSTOMER_TYPES = ['CUSTOMER', 'BOTH'];

/**
 * CustomerRequest (spec sections 3-4) — a pre-binding inquiry. No pricing
 * is required at this stage (spec section 4: "do not require final price
 * at request stage"), so lines carry only product/unit/quantity plus an
 * optional `requestedPrice` the customer mentioned, never a resolved one.
 * No accounting consequence (spec section 151).
 */
@Injectable()
export class CustomerRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.customerRequest.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.customerRequest.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!row) throw new NotFoundAppError('CustomerRequest', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateCustomerRequestDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertCustomer(organizationId, dto.counterpartyId);
    const businessDate = parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, CUSTOMER_REQUEST_TYPE, businessDate, tx);

      const header = await tx.customerRequest.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          number: allocated.formatted,
          documentDate: businessDate,
          currencyId: dto.currencyId,
          requestedDeliveryDate: dto.requestedDeliveryDate ? parseDate(dto.requestedDeliveryDate) : undefined,
          salesManagerId: dto.salesManagerId,
          sourceChannel: dto.sourceChannel,
          description: dto.description,
          externalReference: dto.externalReference,
          status: 'OPEN',
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of dto.lines.entries()) {
        await tx.customerRequestLine.create({
          data: {
            tenantId,
            customerRequestId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: line.quantity,
            requestedPrice: line.requestedPrice,
            requestedDeliveryDate: line.requestedDeliveryDate ? parseDate(line.requestedDeliveryDate) : undefined,
            notes: line.notes,
          },
        });
      }

      await this.audit.record(
        {
          tenantId,
          eventType: 'CUSTOMER_REQUEST_CREATED',
          entityType: CUSTOMER_REQUEST_TYPE,
          entityId: header.id,
          action: 'CREATE',
          userId,
          newValues: { number: header.number, lineCount: dto.lines.length },
        },
        tx,
      );

      return tx.customerRequest.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  async cancel(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.version !== expectedVersion) throw new ConflictAppError('The customer request has been changed by another user');
    if (current.status === 'CONVERTED') throw new ValidationAppError('A converted customer request cannot be cancelled');

    const result = await this.prisma.customerRequest.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConflictAppError('The customer request has been changed by another user');

    await this.audit.record({
      tenantId,
      eventType: 'CUSTOMER_REQUEST_CANCELLED',
      entityType: CUSTOMER_REQUEST_TYPE,
      entityId: id,
      action: 'CANCEL',
      userId,
    });

    return this.get(tenantId, membershipId, organizationId, id);
  }

  private async assertCustomer(organizationId: string, counterpartyId: string) {
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId } });
    if (!counterparty) throw new NotFoundAppError('Counterparty', counterpartyId);
    if (!CUSTOMER_TYPES.includes(counterparty.counterpartyType)) {
      throw new ValidationAppError('Counterparty must be a CUSTOMER or BOTH to receive a customer request');
    }
    if (!counterparty.active) throw new ValidationAppError('Cannot use an inactive counterparty');
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: CUSTOMER_REQUEST_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: CUSTOMER_REQUEST_TYPE, documentType: CUSTOMER_REQUEST_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}
