import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { PriceListService } from '../counterparty-pricing/price-list.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { computeLineTotals, sumDocumentTotals } from './sales-totals.util';
import { SALES_INVOICE_TYPE } from './sales-invoice.repository';
import { CreateSalesInvoiceDto, SalesLineItemDto } from './dto/sales-document.dto';

const SEQUENCE_PREFIX = 'SI';
const CUSTOMER_TYPES = ['CUSTOMER', 'BOTH'];

interface ResolvedLine {
  productId: string;
  unitId: string;
  quantity: Decimal;
  price: Decimal;
  taxRate: Decimal;
  lineTotal: Decimal;
  taxAmount: Decimal;
  lineTotalWithTax: Decimal;
  priceListId: string | null;
  productPriceId: string | null;
  description?: string;
  sourceOrderLineId?: string;
  sourceShipmentLineId?: string;
}

/**
 * Phase 4 — SalesInvoice service. Shape mirrors SalesOrderService: SAVE
 * snapshots SALE prices + totals, posting only reads the snapshot. Invoices
 * may be standalone or created based on an order (header-only draft via the
 * SALES_ORDER => SALES_INVOICE mapper, lines added via update before
 * posting); totals validation (grandTotal > 0 at posting) lives in the
 * handler.
 */
@Injectable()
export class SalesInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly prices: PriceListService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.salesInvoice.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!invoice) throw new NotFoundAppError('SalesInvoice', id);
    return invoice;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateSalesInvoiceDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    await this.assertCustomer(organizationId, dto.counterpartyId);
    await this.assertCurrency(dto.currencyId);

    if (dto.lines.length === 0) throw new ValidationAppError('Invoice must have at least one line');
    const priceIncludesTax = dto.priceIncludesTax ?? false;
    const lines = await this.resolveLines(
      tenantId,
      membershipId,
      organizationId,
      dto.lines,
      businessDate,
      dto.counterpartyId,
      priceIncludesTax,
    );
    const totals = sumDocumentTotals(lines);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        SALES_INVOICE_TYPE,
        businessDate,
        tx,
      );

      const header = await tx.salesInvoice.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          number: allocated.formatted,
          documentDate: businessDate,
          currencyId: dto.currencyId,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          priceIncludesTax,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of lines.entries()) {
        await tx.salesInvoiceLine.create({
          data: {
            tenantId,
            salesInvoiceId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: line.quantity,
            price: line.price,
            lineTotal: line.lineTotal,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineTotalWithTax: line.lineTotalWithTax,
            priceListId: line.priceListId,
            productPriceId: line.productPriceId,
            description: line.description,
            sourceOrderLineId: line.sourceOrderLineId,
            sourceShipmentLineId: line.sourceShipmentLineId,
            createdBy: userId,
            updatedBy: userId,
          },
        });
      }

      await this.audit.record(
        {
          tenantId,
          eventType: 'SALES_INVOICE_CREATED',
          entityType: SALES_INVOICE_TYPE,
          entityId: header.id,
          action: 'CREATE',
          userId,
          newValues: { number: header.number, grandTotal: totals.grandTotal.toString() },
        },
        tx,
      );

      return tx.salesInvoice.findFirst({
        where: { id: header.id },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
    });
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    patch: {
      counterpartyId?: string;
      documentDate?: string;
      currencyId?: string;
      priceIncludesTax?: boolean;
      description?: string;
      lines?: SalesLineItemDto[];
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus === 'POSTED') {
      throw new ValidationAppError('Unpost the document before editing it');
    }
    if (current.status === 'CANCELLED') {
      throw new ValidationAppError('Cannot edit a cancelled document');
    }

    const businessDate =
      patch.documentDate !== undefined ? this.parseDate(patch.documentDate) : current.documentDate;
    const counterpartyId = patch.counterpartyId ?? current.counterpartyId;
    if (patch.counterpartyId !== undefined) {
      await this.assertCustomer(organizationId, patch.counterpartyId);
    }
    if (patch.currencyId !== undefined) {
      await this.assertCurrency(patch.currencyId);
    }
    const priceIncludesTax = patch.priceIncludesTax ?? current.priceIncludesTax;

    let totals = {
      subtotal: current.subtotal,
      taxTotal: current.taxTotal,
      grandTotal: current.grandTotal,
    };
    let resolved: ResolvedLine[] | null = null;
    if (patch.lines !== undefined) {
      if (patch.lines.length === 0) throw new ValidationAppError('Invoice must have at least one line');
      resolved = await this.resolveLines(
        tenantId,
        membershipId,
        organizationId,
        patch.lines,
        businessDate,
        counterpartyId,
        priceIncludesTax,
      );
      totals = sumDocumentTotals(resolved);
    } else if (patch.priceIncludesTax !== undefined) {
      const recomputed = current.lines.map((l) =>
        computeLineTotals(
          new Decimal(l.quantity.toString()),
          new Decimal(l.price.toString()),
          new Decimal(l.taxRate.toString()),
          priceIncludesTax,
        ),
      );
      totals = sumDocumentTotals(recomputed);
    }

    const updated = await this.prisma.runInTransaction(async (tx) => {
      const result = await tx.salesInvoice.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: {
          ...(patch.counterpartyId !== undefined ? { counterpartyId: patch.counterpartyId } : {}),
          ...(patch.documentDate !== undefined ? { documentDate: businessDate } : {}),
          ...(patch.currencyId !== undefined ? { currencyId: patch.currencyId } : {}),
          ...(patch.priceIncludesTax !== undefined ? { priceIncludesTax } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      if (resolved) {
        // Editing lines replaces the set wholesale; any previous
        // source-order links came from the old lines and must not survive.
        await tx.salesInvoiceLine.deleteMany({ where: { salesInvoiceId: id } });
        for (const [index, line] of resolved.entries()) {
          await tx.salesInvoiceLine.create({
            data: {
              tenantId,
              salesInvoiceId: id,
              position: index,
              productId: line.productId,
              unitId: line.unitId,
              quantity: line.quantity,
              price: line.price,
              lineTotal: line.lineTotal,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              lineTotalWithTax: line.lineTotalWithTax,
              priceListId: line.priceListId,
              productPriceId: line.productPriceId,
              description: line.description,
              sourceOrderLineId: line.sourceOrderLineId,
              sourceShipmentLineId: line.sourceShipmentLineId,
              createdBy: userId,
              updatedBy: userId,
            },
          });
        }
      }

      return tx.salesInvoice.findFirst({
        where: { id },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
    });

    await this.audit.record({
      tenantId,
      eventType: 'SALES_INVOICE_UPDATED',
      entityType: SALES_INVOICE_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { ...patch, lines: patch.lines?.length },
    });

    return updated;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async assertCustomer(organizationId: string, counterpartyId: string) {
    const cp = await this.prisma.counterparty.findFirst({
      where: { id: counterpartyId, organizationId },
    });
    if (!cp) throw new ValidationAppError('Counterparty does not belong to this organization');
    if (!cp.active) throw new ValidationAppError('Counterparty is inactive');
    if (!CUSTOMER_TYPES.includes(cp.counterpartyType)) {
      throw new ValidationAppError('Counterparty is not a customer');
    }
  }

  private async assertCurrency(currencyId?: string) {
    if (!currencyId) return;
    const currency = await this.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) throw new ValidationAppError('Currency not found');
  }

  private async resolveLines(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    lines: SalesLineItemDto[],
    businessDate: Date,
    counterpartyId: string,
    priceIncludesTax: boolean,
  ): Promise<ResolvedLine[]> {
    const resolved: ResolvedLine[] = [];
    for (const line of lines) {
      const quantity = new Decimal(line.quantity.toString());
      if (!quantity.isFinite() || quantity.lte(0)) {
        throw new ValidationAppError('Line quantity must be positive');
      }

      const product = await this.prisma.product.findFirst({
        where: { id: line.productId, organizationId },
      });
      if (!product || !product.active) {
        throw new ValidationAppError('Product does not belong to this organization or is inactive');
      }

      const unit = await this.prisma.unitOfMeasure.findFirst({
        where: { id: line.unitId, tenantId },
      });
      if (!unit) throw new ValidationAppError('Unit of measure not found');

      const taxRate = new Decimal((line.taxRate ?? 0).toString());
      if (!taxRate.isFinite() || taxRate.lt(0)) {
        throw new ValidationAppError('Line tax rate must not be negative');
      }

      let price: Decimal;
      let priceListId: string | null = null;
      let productPriceId: string | null = null;
      if (line.price !== undefined) {
        price = new Decimal(line.price.toString());
        if (!price.isFinite() || price.lt(0)) {
          throw new ValidationAppError('Line price must not be negative');
        }
      } else {
        const found = await this.prices.resolvePrice(
          tenantId,
          membershipId,
          organizationId,
          'SALE',
          line.productId,
          businessDate,
          Number(line.quantity),
          counterpartyId,
        );
        if (!found) {
          throw new ValidationAppError(
            `No sale price found for product ${product.code} at this date/quantity`,
          );
        }
        price = new Decimal(found.price.toString());
        priceListId = found.priceListId;
        productPriceId = found.id;
      }

      const computed = computeLineTotals(quantity, price, taxRate, priceIncludesTax);
      resolved.push({
        productId: line.productId,
        unitId: line.unitId,
        quantity,
        price,
        taxRate,
        ...computed,
        priceListId,
        productPriceId,
        description: line.description,
        sourceOrderLineId: line.sourceOrderLineId,
        sourceShipmentLineId: line.sourceShipmentLineId,
      });
    }
    return resolved;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: SALES_INVOICE_TYPE } },
    });
    if (existing) return;

    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: SALES_INVOICE_TYPE,
          documentType: SALES_INVOICE_TYPE,
          prefix: SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race to create the sequence for this tenant — another
      // concurrent create() already did it, which is fine.
    }
  }
}
