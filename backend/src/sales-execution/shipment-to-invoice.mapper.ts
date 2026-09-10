import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { SHIPMENT_TYPE } from './shipment.repository';
import { SALES_INVOICE_TYPE } from '../sales-documents/sales-invoice.repository';

/**
 * SHIPMENT => SALES_INVOICE mapper (spec section 22). Header-only, same
 * convention as SALES_ORDER => SALES_INVOICE: lines are added afterward
 * via the invoice update endpoint (now line-source-aware, spec sections
 * 21-25), which is where `sourceShipmentLineId` gets set and
 * `SalesInvoicePostingHandler.validateForPosting` enforces "only
 * uninvoiced Shipment quantity is eligible".
 */
@Injectable()
export class ShipmentToSalesInvoiceMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = SHIPMENT_TYPE;
  readonly targetDocumentType = SALES_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;

    const shipment = await client.shipment.findFirst({ where: { id: source.id, tenantId: source.tenantId } });
    if (!shipment) throw new ValidationAppError(`Shipment not found: ${source.id}`);
    if (shipment.postingStatus !== 'POSTED') {
      throw new ValidationAppError('Only a posted shipment can be invoiced');
    }

    await this.ensureSequence(source.tenantId);
    const allocated = await this.numbering.allocateNumber(source.tenantId, SALES_INVOICE_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: shipment.organizationId,
      counterpartyId: shipment.counterpartyId,
      number: allocated.formatted,
      documentDate: new Date(),
      sourceShipmentId: shipment.id,
      description: `Based on shipment ${shipment.number ?? shipment.id}`,
    };
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SALES_INVOICE_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: SALES_INVOICE_TYPE, documentType: SALES_INVOICE_TYPE, prefix: 'SI', padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}
