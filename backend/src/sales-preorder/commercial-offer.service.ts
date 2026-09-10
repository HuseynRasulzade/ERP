import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { PriceListService } from '../counterparty-pricing/price-list.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import {
  ConflictAppError,
  NotFoundAppError,
  OfferExpiredError,
  PermissionDeniedError,
  ValidationAppError,
} from '../common/errors/app-error';
import { COMMERCIAL_OFFER_TYPE } from './commercial-offer.repository';
import { CommercialOfferLineDto, CreateCommercialOfferDto } from './dto/sales-preorder.dto';
import { RequestContextService } from '../common/context/request-context.service';
import { PermissionCodes } from '../rbac/permission-codes';

const SEQUENCE_PREFIX = 'CO';
const CUSTOMER_TYPES = ['CUSTOMER', 'BOTH'];
const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

interface ResolvedOfferLine {
  productId: string;
  unitId: string;
  quantity: Decimal;
  price: Decimal;
  discountPercent: Decimal | null;
  discountAmount: Decimal;
  lineTotal: Decimal;
  taxRate: Decimal;
  taxAmount: Decimal;
  lineTotalWithTax: Decimal;
  priceListId: string | null;
  productPriceId: string | null;
  expectedDeliveryDate?: Date;
  description?: string;
}

/**
 * CommercialOffer (spec sections 5-13). Centralizes PriceResolver +
 * discount + Tax Preview (spec sections 7, 10-11, 33) — never a black box:
 * every line keeps its `priceListId`/`productPriceId` source and its
 * resolved tax rule via the Tax Engine's explanation. Tax here is PREVIEW
 * ONLY: `TaxCalculationService.calculateLine` never writes a TaxMovement
 * (spec section 103) — see docs/SALES_PREORDER.md.
 */
@Injectable()
export class CommercialOfferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly prices: PriceListService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly requestContext: RequestContextService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.commercialOffer.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.commercialOffer.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!row) throw new NotFoundAppError('CommercialOffer', id);
    return this.withDerivedStatus(row);
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateCommercialOfferDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = parseDate(dto.documentDate);
    await this.assertCustomer(organizationId, dto.counterpartyId);
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
    const totals = sumTotals(lines);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, COMMERCIAL_OFFER_TYPE, businessDate, tx);

      const header = await tx.commercialOffer.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          number: allocated.formatted,
          documentDate: businessDate,
          validUntil: dto.validUntil ? parseDate(dto.validUntil) : undefined,
          currencyId: dto.currencyId,
          priceIncludesTax,
          status: 'DRAFT',
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of lines.entries()) {
        await tx.commercialOfferLine.create({
          data: {
            tenantId,
            commercialOfferId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: line.quantity,
            price: line.price,
            discountPercent: line.discountPercent ?? undefined,
            discountAmount: line.discountAmount,
            lineTotal: line.lineTotal,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineTotalWithTax: line.lineTotalWithTax,
            priceListId: line.priceListId,
            productPriceId: line.productPriceId,
            expectedDeliveryDate: line.expectedDeliveryDate,
            description: line.description,
          },
        });
      }

      await this.audit.record(
        {
          tenantId,
          eventType: 'COMMERCIAL_OFFER_CREATED',
          entityType: COMMERCIAL_OFFER_TYPE,
          entityId: header.id,
          action: 'CREATE',
          userId,
          newValues: { number: header.number, grandTotal: totals.grandTotal.toString() },
        },
        tx,
      );

      return tx.commercialOffer.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  async send(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    return this.transition(tenantId, membershipId, organizationId, id, userId, expectedVersion, 'DRAFT', 'SENT', 'COMMERCIAL_OFFER_SENT', { sentAt: new Date() });
  }

  async accept(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    const offer = await this.get(tenantId, membershipId, organizationId, id);
    if (offer.status === 'EXPIRED') throw new OfferExpiredError(id);
    return this.transition(tenantId, membershipId, organizationId, id, userId, expectedVersion, ['SENT', 'DRAFT'], 'ACCEPTED', 'COMMERCIAL_OFFER_ACCEPTED', { acceptedAt: new Date() });
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    return this.transition(tenantId, membershipId, organizationId, id, userId, expectedVersion, ['SENT', 'DRAFT'], 'REJECTED', 'COMMERCIAL_OFFER_REJECTED', { rejectedAt: new Date() });
  }

  async cancel(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    return this.transition(tenantId, membershipId, organizationId, id, userId, expectedVersion, undefined, 'CANCELLED', 'COMMERCIAL_OFFER_CANCELLED', { cancelledAt: new Date() });
  }

  /** Marks an offer CONVERTED once a SalesOrder was created based on it —
   * called by CommercialOfferToSalesOrderMapper inside its own transaction. */
  async markConverted(tenantId: string, offerId: string, tx: any) {
    await tx.commercialOffer.update({ where: { id: offerId }, data: { status: 'CONVERTED' } });
  }

  /**
   * Expiry is derived, not stored (spec section 12): a DRAFT/SENT/ACCEPTED
   * offer whose `validUntil` has passed reports as EXPIRED without ever
   * mutating the row — so "current business date" never has to be
   * reconciled against a cron job.
   */
  private withDerivedStatus<T extends { status: string; validUntil: Date | null }>(offer: T): T {
    if (['DRAFT', 'SENT', 'ACCEPTED'].includes(offer.status) && offer.validUntil && offer.validUntil < new Date()) {
      return { ...offer, status: 'EXPIRED' };
    }
    return offer;
  }

  private async transition(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    fromStatuses: string | string[] | undefined,
    toStatus: string,
    eventType: string,
    extra: Record<string, unknown>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.version !== expectedVersion) throw new ConflictAppError('The offer has been changed by another user');
    const allowed = fromStatuses === undefined ? true : (Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses]).includes(current.status);
    if (!allowed) throw new ValidationAppError(`Cannot move offer from ${current.status} to ${toStatus}`);

    const result = await this.prisma.commercialOffer.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { status: toStatus, ...extra, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConflictAppError('The offer has been changed by another user');

    await this.audit.record({ tenantId, eventType, entityType: COMMERCIAL_OFFER_TYPE, entityId: id, action: 'UPDATE', userId });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private async resolveLines(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    lines: CommercialOfferLineDto[],
    businessDate: Date,
    counterpartyId: string,
    priceIncludesTax: boolean,
  ): Promise<ResolvedOfferLine[]> {
    const resolved: ResolvedOfferLine[] = [];

    for (const line of lines) {
      const quantity = new Decimal(line.quantity);
      if (quantity.lte(0)) throw new ValidationAppError('Line quantity must be positive');

      let price: Decimal;
      let priceListId: string | null = null;
      let productPriceId: string | null = null;
      const resolvedPrice = await this.prices.resolvePrice(
        tenantId, membershipId, organizationId, 'SALE', line.productId, businessDate, Number(line.quantity), counterpartyId,
      );

      if (line.price !== undefined) {
        price = new Decimal(line.price);
        if (resolvedPrice && !price.equals(resolvedPrice.price)) {
          // Price override (spec section 9): requires permission, audited.
          if (!this.requestContext.hasPermission(PermissionCodes.SALES_PRICE_OVERRIDE)) {
            throw new PermissionDeniedError(PermissionCodes.SALES_PRICE_OVERRIDE);
          }
          await this.audit.record({
            tenantId,
            eventType: 'PRICE_OVERRIDDEN',
            entityType: 'CommercialOfferLine',
            entityId: line.productId,
            action: 'UPDATE',
            oldValues: { price: resolvedPrice.price.toString() },
            newValues: { price: price.toString() },
          });
        }
      } else {
        if (!resolvedPrice) throw new ValidationAppError(`No SALE price found for product ${line.productId}`);
        price = new Decimal(resolvedPrice.price.toString());
        priceListId = resolvedPrice.priceListId;
        productPriceId = resolvedPrice.id;
      }

      const base = price.mul(quantity);
      const discountPercent = line.discountPercent ? new Decimal(line.discountPercent) : null;
      const discountAmount = discountPercent ? base.mul(discountPercent).div(100) : new Decimal(0);
      const afterDiscount = base.minus(discountAmount);

      const taxResult = await this.taxCalculation.calculateLine(
        {
          tenantId,
          organizationId,
          businessDate,
          taxPointDate: businessDate,
          operationType: 'SALE',
          taxCategoryCode: line.taxCategoryCode ?? DEFAULT_TAX_CATEGORY,
          taxpayerSide: 'SELLER',
        },
        { amount: afterDiscount, priceIncludesTax },
      );

      resolved.push({
        productId: line.productId,
        unitId: line.unitId,
        quantity,
        price,
        discountPercent,
        discountAmount: round2(discountAmount),
        lineTotal: taxResult.taxableBase,
        taxRate: taxResult.rate,
        taxAmount: taxResult.taxAmount,
        lineTotalWithTax: taxResult.grossAmount,
        priceListId,
        productPriceId,
        expectedDeliveryDate: line.expectedDeliveryDate ? parseDate(line.expectedDeliveryDate) : undefined,
        description: line.description,
      });
    }
    return resolved;
  }

  private async assertCustomer(organizationId: string, counterpartyId: string) {
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId } });
    if (!counterparty) throw new NotFoundAppError('Counterparty', counterpartyId);
    if (!CUSTOMER_TYPES.includes(counterparty.counterpartyType)) {
      throw new ValidationAppError('Counterparty must be a CUSTOMER or BOTH to receive a commercial offer');
    }
    if (!counterparty.active) throw new ValidationAppError('Cannot use an inactive counterparty');
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: COMMERCIAL_OFFER_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: COMMERCIAL_OFFER_TYPE, documentType: COMMERCIAL_OFFER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}

function round2(v: Decimal): Decimal {
  return new Decimal(v.toFixed(2));
}

function sumTotals(lines: ResolvedOfferLine[]) {
  let subtotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  let grandTotal = new Decimal(0);
  for (const l of lines) {
    subtotal = subtotal.add(l.lineTotal);
    taxTotal = taxTotal.add(l.taxAmount);
    grandTotal = grandTotal.add(l.lineTotalWithTax);
  }
  return { subtotal, taxTotal, grandTotal };
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}
