import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { OrderFulfillmentService } from '../sales-preorder/order-fulfillment.service';
import { SALES_ORDER_TYPE } from '../sales-documents/sales-order.repository';
import { SHIPMENT_TYPE } from './shipment.repository';

/**
 * SALES_ORDER => SHIPMENT mapper (spec section 6). Only remaining
 * fulfillable quantity is copied by default — never the full original
 * order quantity, even if some was already shipped: "Ordered 100, already
 * shipped 40, cancelled 10 -> new Shipment defaults to max 50."
 */
@Injectable()
export class SalesOrderToShipmentMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = SALES_ORDER_TYPE;
  readonly targetDocumentType = SHIPMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly fulfillment: OrderFulfillmentService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;

    const order = await client.salesOrder.findFirst({
      where: { id: source.id, tenantId: source.tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!order) throw new ValidationAppError(`Sales order not found: ${source.id}`);
    if (!order.warehouseId) {
      throw new ValidationAppError('Sales order has no warehouse — set one before creating a shipment from it');
    }

    const lines = [];
    for (const line of order.lines) {
      if (line.isService) continue; // spec section 11: services don't ship
      const remaining = await this.fulfillment.remainingForLine(source.tenantId, line.id);
      if (remaining.lte(0)) continue;
      lines.push({
        sourceOrderLineId: line.id,
        productId: line.productId,
        unitId: line.unitId,
        quantity: remaining.toString(),
        warehouseId: line.warehouseId ?? order.warehouseId,
      });
    }
    if (lines.length === 0) {
      throw new ValidationAppError('This order has no remaining fulfillable goods lines to ship');
    }

    await this.ensureSequence(source.tenantId);
    const allocated = await this.numbering.allocateNumber(source.tenantId, SHIPMENT_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: order.organizationId,
      counterpartyId: order.counterpartyId,
      warehouseId: order.warehouseId,
      number: allocated.formatted,
      documentDate: new Date(),
      customerOrderId: order.id,
      description: `Based on order ${order.number ?? order.id}`,
      lines,
    };
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SHIPMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: SHIPMENT_TYPE, documentType: SHIPMENT_TYPE, prefix: 'SHP', padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}
