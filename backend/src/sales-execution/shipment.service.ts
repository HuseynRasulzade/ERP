import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { SHIPMENT_TYPE } from './shipment.repository';
import { CreateShipmentDto } from './dto/sales-execution.dto';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';

const SEQUENCE_PREFIX = 'SHP';
const CUSTOMER_TYPES = ['CUSTOMER', 'BOTH'];

/**
 * Shipment (spec sections 3, 6-11) — kept structurally distinct from
 * SalesInvoice (see ShipmentPostingHandler's docstring and
 * docs/SALES_EXECUTION.md). A standalone shipment (no `customerOrderId`)
 * is allowed, matching spec section 10.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly batchSerial: BatchSerialService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.shipment.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.shipment.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('Shipment', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateShipmentDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertCustomer(organizationId, dto.counterpartyId);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, organizationId } });
    if (!warehouse) throw new NotFoundAppError('Warehouse', dto.warehouseId);
    if (dto.customerOrderId) {
      const order = await this.prisma.salesOrder.findFirst({ where: { id: dto.customerOrderId, organizationId } });
      if (!order) throw new NotFoundAppError('SalesOrder', dto.customerOrderId);
    }

    const businessDate = parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SHIPMENT_TYPE, businessDate, tx);

      const header = await tx.shipment.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          warehouseId: dto.warehouseId,
          number: allocated.formatted,
          documentDate: businessDate,
          customerOrderId: dto.customerOrderId,
          deliveryAddressSnapshot: dto.deliveryAddressSnapshot,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of dto.lines.entries()) {
        const quantity = Number(line.quantity);
        if (quantity <= 0) throw new ValidationAppError('Shipment line quantity must be positive');

        const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
        if (!product) throw new ValidationAppError('Shipment line references an unknown product');
        this.batchSerial.validateCapture(product, line.batchId, line.serialNumbers, quantity);

        const created = await tx.shipmentLine.create({
          data: {
            tenantId,
            shipmentId: header.id,
            position: index,
            sourceOrderLineId: line.sourceOrderLineId,
            productId: line.productId,
            unitId: line.unitId,
            quantity: line.quantity,
            warehouseId: line.warehouseId ?? dto.warehouseId,
            batchId: line.batchId,
            notes: line.notes,
          },
        });
        if (line.serialNumbers?.length) {
          await this.batchSerial.captureSerials(tenantId, SHIPMENT_TYPE, created.id, line.serialNumbers, tx);
        }
      }

      await this.audit.record(
        { tenantId, eventType: 'SHIPMENT_CREATED', entityType: SHIPMENT_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, lineCount: dto.lines.length } },
        tx,
      );

      return tx.shipment.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  private async assertCustomer(organizationId: string, counterpartyId: string) {
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId } });
    if (!counterparty) throw new NotFoundAppError('Counterparty', counterpartyId);
    if (!CUSTOMER_TYPES.includes(counterparty.counterpartyType)) {
      throw new ValidationAppError('Counterparty must be a CUSTOMER or BOTH to receive a shipment');
    }
    if (!counterparty.active) throw new ValidationAppError('Cannot use an inactive counterparty');
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SHIPMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: SHIPMENT_TYPE, documentType: SHIPMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}
