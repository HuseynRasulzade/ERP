import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { ApprovalService } from '../approvals/approval.service';
import { PurchasePriceResolverService } from './purchase-price-resolver.service';
import { ConcurrencyConflictError, NotFoundAppError, SupplierNotEligibleError, ValidationAppError } from '../common/errors/app-error';
import { computeLineTotals, sumDocumentTotals } from '../sales-documents/sales-totals.util';
import { PURCHASE_ORDER_TYPE } from './purchase-order.repository';
import { CreatePurchaseOrderDto, PurchaseLineItemDto, UpdatePurchaseOrderDto } from './dto/procurement.dto';
import { checkContractLimit } from './contract-limit.util';

const SEQUENCE_PREFIX = 'PO';
const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];
const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

interface ResolvedPOLine {
  productId: string;
  unitId: string;
  quantity: Decimal;
  // Null: no explicit price given and no PURCHASE price list matched this
  // product/supplier/date — the line still saves as an incomplete DRAFT
  // line (spec: "qiymət məlumatı yoxdursa ... boş qiymətlə də yaradılıb
  // Qaralama statusunda yadda saxlanıla bilsin"); only
  // PurchaseOrderPostingHandler blocks on it, at confirmation time.
  price: Decimal | null;
  taxRate: Decimal;
  lineTotal: Decimal;
  taxAmount: Decimal;
  lineTotalWithTax: Decimal;
  priceListId: string | null;
  productPriceId: string | null;
  isService: boolean;
  warehouseId?: string;
  expectedDeliveryDate?: Date;
  supplierProductCode?: string | null;
  requirementLineId?: string;
  description?: string;
  deliverySchedule?: { plannedDate: Date; quantity: Decimal; warehouseId?: string }[];
}

/**
 * PurchaseOrder service (spec sections 20-25, 51, 69-70, 130). Mirrors
 * SalesOrderService: SAVE snapshots price via PurchasePriceResolver
 * (PURCHASE lists, supplier-scoped) and a tax PREVIEW via
 * TaxCalculationService (never TaxRegisterService — spec section 96, no
 * TaxMovement is ever created here). Numbers come from NumberingService
 * (PO- prefix, YEARLY reset). Historical integrity (spec section 130):
 * once saved, a line's price/tax snapshot never silently changes when
 * master data changes later — only an explicit edit or
 * recalculate-prices/-tax command touches it.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly priceResolver: PurchasePriceResolverService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly approvals: ApprovalService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.purchaseOrder.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { position: 'asc' }, include: { deliverySchedule: true } }, holds: true, paymentSchedule: true },
    });
    if (!order) throw new NotFoundAppError('PurchaseOrder', id);
    return order;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreatePurchaseOrderDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    await this.assertSupplier(tenantId, organizationId, dto.counterpartyId);
    await this.assertCurrency(dto.currencyId);

    const priceIncludesTax = dto.priceIncludesTax ?? false;
    const lines = await this.resolveLines(tenantId, membershipId, organizationId, dto.lines, businessDate, dto.counterpartyId, priceIncludesTax);
    const totals = sumDocumentTotals(lines);
    await this.ensureSequence(tenantId);

    let limitCheck: Awaited<ReturnType<typeof checkContractLimit>> = null;
    if (dto.contractId) {
      limitCheck = await checkContractLimit(this.prisma, tenantId, dto.contractId, undefined, totals.grandTotal);
      if (limitCheck?.exceeds && limitCheck.policy === 'BLOCK') {
        throw new ValidationAppError(
          `This order would bring the contract's total to ${limitCheck.projectedTotal.toFixed(2)}, exceeding its limit of ${limitCheck.limitAmount!.toFixed(2)}`,
        );
      }
    }

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PURCHASE_ORDER_TYPE, businessDate, tx);

      const header = await tx.purchaseOrder.create({
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
          warehouseId: dto.warehouseId,
          expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
          supplierReference: dto.supplierReference,
          purchaseChannel: dto.purchaseChannel,
          buyerId: dto.buyerId,
          contractId: dto.contractId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.createLines(tx, tenantId, header.id, lines, userId);

      if (limitCheck?.exceeds) {
        await this.audit.record(
          {
            tenantId, eventType: 'CONTRACT_LIMIT_EXCEEDED', entityType: PURCHASE_ORDER_TYPE, entityId: header.id, action: 'CREATE', userId,
            newValues: { contractId: dto.contractId, limitAmount: limitCheck.limitAmount!.toString(), projectedTotal: limitCheck.projectedTotal.toString(), policy: limitCheck.policy },
          },
          tx,
        );
      }

      await this.audit.record(
        { tenantId, eventType: 'PURCHASE_ORDER_CREATED', entityType: PURCHASE_ORDER_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, grandTotal: totals.grandTotal.toString() } },
        tx,
      );

      await this.approvals.createStepsForDocument(tenantId, organizationId, PURCHASE_ORDER_TYPE, header.id, tx);

      return tx.purchaseOrder.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    patch: Omit<UpdatePurchaseOrderDto, 'expectedVersion'>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus === 'POSTED') throw new ValidationAppError('Reopen (unpost) the purchase order before editing it');
    if (current.status === 'CANCELLED') throw new ValidationAppError('Cannot edit a cancelled purchase order');

    const businessDate = patch.documentDate !== undefined ? this.parseDate(patch.documentDate) : current.documentDate;
    const counterpartyId = patch.counterpartyId ?? current.counterpartyId;
    if (patch.counterpartyId !== undefined) await this.assertSupplier(tenantId, organizationId, patch.counterpartyId);
    if (patch.currencyId !== undefined) await this.assertCurrency(patch.currencyId);
    const priceIncludesTax = patch.priceIncludesTax ?? current.priceIncludesTax;

    let totals = { subtotal: current.subtotal, taxTotal: current.taxTotal, grandTotal: current.grandTotal };
    let resolved: ResolvedPOLine[] | null = null;
    if (patch.lines !== undefined) {
      if (patch.lines.length === 0) throw new ValidationAppError('Purchase order must have at least one line');
      resolved = await this.resolveLines(tenantId, membershipId, organizationId, patch.lines, businessDate, counterpartyId, priceIncludesTax);
      totals = sumDocumentTotals(resolved);
    } else if (patch.priceIncludesTax !== undefined) {
      const recomputed = current.lines.map((l: any) => l.price == null
        ? { quantity: new Decimal(l.quantity.toString()), price: null, taxRate: new Decimal(0), lineTotal: new Decimal(0), taxAmount: new Decimal(0), lineTotalWithTax: new Decimal(0) }
        : computeLineTotals(new Decimal(l.quantity.toString()), new Decimal(l.price.toString()), new Decimal(l.taxRate.toString()), priceIncludesTax));
      totals = sumDocumentTotals(recomputed);
    }

    const effectiveContractId = patch.contractId !== undefined ? patch.contractId : (current as any).contractId ?? undefined;
    let limitCheck: Awaited<ReturnType<typeof checkContractLimit>> = null;
    if (effectiveContractId) {
      limitCheck = await checkContractLimit(this.prisma, tenantId, effectiveContractId, id, totals.grandTotal);
      if (limitCheck?.exceeds && limitCheck.policy === 'BLOCK') {
        throw new ValidationAppError(
          `This order would bring the contract's total to ${limitCheck.projectedTotal.toFixed(2)}, exceeding its limit of ${limitCheck.limitAmount!.toFixed(2)}`,
        );
      }
    }

    const updated = await this.prisma.runInTransaction(async (tx) => {
      const result = await tx.purchaseOrder.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: {
          ...(patch.counterpartyId !== undefined ? { counterpartyId: patch.counterpartyId } : {}),
          ...(patch.documentDate !== undefined ? { documentDate: businessDate } : {}),
          ...(patch.currencyId !== undefined ? { currencyId: patch.currencyId } : {}),
          ...(patch.priceIncludesTax !== undefined ? { priceIncludesTax } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.expectedDeliveryDate !== undefined ? { expectedDeliveryDate: new Date(patch.expectedDeliveryDate) } : {}),
          ...(patch.supplierReference !== undefined ? { supplierReference: patch.supplierReference } : {}),
          ...(patch.purchaseChannel !== undefined ? { purchaseChannel: patch.purchaseChannel } : {}),
          ...(patch.buyerId !== undefined ? { buyerId: patch.buyerId } : {}),
          ...(patch.contractId !== undefined ? { contractId: patch.contractId } : {}),
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      if (resolved) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await this.createLines(tx, tenantId, id, resolved, userId);
      }

      return tx.purchaseOrder.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });

    await this.audit.record({ tenantId, eventType: 'PURCHASE_ORDER_UPDATED', entityType: PURCHASE_ORDER_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { ...patch, lines: patch.lines?.length } });
    if (limitCheck?.exceeds) {
      await this.audit.record({
        tenantId, eventType: 'CONTRACT_LIMIT_EXCEEDED', entityType: PURCHASE_ORDER_TYPE, entityId: id, action: 'UPDATE', userId,
        newValues: { contractId: effectiveContractId, limitAmount: limitCheck.limitAmount!.toString(), projectedTotal: limitCheck.projectedTotal.toString(), policy: limitCheck.policy },
      });
    }
    return updated;
  }

  /** Cancels the remainder of one line (spec section 121): reduces what
   * remains orderable, never the original `quantity` — history stays
   * intact ("received 40, cancelled 60" not "ordered 40"). */
  async cancelLine(tenantId: string, membershipId: string, organizationId: string, orderId: string, lineId: string, userId: string, cancelQuantity: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.get(tenantId, membershipId, organizationId, orderId);
    const line = order.lines.find((l: any) => l.id === lineId);
    if (!line) throw new NotFoundAppError('PurchaseOrderLine', lineId);

    const qty = new Decimal(cancelQuantity.toString());
    if (qty.lt(0)) throw new ValidationAppError('Cancel quantity must not be negative');
    const remaining = new Decimal(line.quantity.toString()).minus(line.cancelledQuantity.toString());
    if (qty.gt(remaining)) throw new ValidationAppError(`Cannot cancel more than the remaining quantity (${remaining.toString()})`);

    const updated = await this.prisma.purchaseOrderLine.update({
      where: { id: lineId },
      data: { cancelledQuantity: new Decimal(line.cancelledQuantity.toString()).plus(qty).toString() },
    });
    await this.audit.record({ tenantId, eventType: 'PURCHASE_ORDER_LINE_CANCELLED', entityType: PURCHASE_ORDER_TYPE, entityId: orderId, action: 'UPDATE', userId, newValues: { lineId, cancelQuantity } });
    return updated;
  }

  // -- Approval -----------------------------------------------------------------

  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.approve(tenantId, organizationId, PURCHASE_ORDER_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.reject(tenantId, organizationId, PURCHASE_ORDER_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  // -- validation / resolution helpers ---------------------------------------

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async assertSupplier(tenantId: string, organizationId: string, counterpartyId: string) {
    const cp = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId, tenantId } });
    if (!cp) throw new ValidationAppError('Counterparty does not belong to this organization');
    if (!cp.active) throw new SupplierNotEligibleError('inactive counterparty');
    if (!SUPPLIER_TYPES.includes(cp.counterpartyType)) throw new SupplierNotEligibleError('counterparty does not have the SUPPLIER role');
    if (cp.riskStatus === 'BLACKLISTED') throw new SupplierNotEligibleError('blacklisted counterparty');
  }

  private async assertCurrency(currencyId?: string) {
    if (!currencyId) return;
    const currency = await this.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) throw new ValidationAppError('Currency not found');
  }

  /**
   * Validates every line and snapshots price + tax preview. An explicit
   * line price is kept as-is; an omitted one is filled from PURCHASE price
   * lists for this supplier (spec section 51 — never the sales price). An
   * explicit taxRate is kept as-is (tax-inclusive supplier prices, spec
   * section 70); an omitted one is filled from a live TaxCalculationService
   * PREVIEW (operationType PURCHASE, taxpayerSide BUYER) — never
   * TaxRegisterService, never a TaxMovement (spec section 96).
   */
  private async resolveLines(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    lines: PurchaseLineItemDto[],
    businessDate: Date,
    counterpartyId: string,
    priceIncludesTax: boolean,
  ): Promise<ResolvedPOLine[]> {
    const resolved: ResolvedPOLine[] = [];
    for (const line of lines) {
      const quantity = new Decimal(line.quantity.toString());
      if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationAppError('Line quantity must be positive');

      const product = await this.prisma.product.findFirst({ where: { id: line.productId, organizationId } });
      if (!product || !product.active) throw new ValidationAppError('Product does not belong to this organization or is inactive');

      const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id: line.unitId, tenantId } });
      if (!unit) throw new ValidationAppError('Unit of measure not found');

      let price: Decimal | null;
      let priceListId: string | null = null;
      let productPriceId: string | null = null;
      if (line.price !== undefined) {
        price = new Decimal(line.price.toString());
        if (!price.isFinite() || price.lt(0)) throw new ValidationAppError('Line price must not be negative');
      } else {
        const found = await this.priceResolver.resolve(tenantId, membershipId, organizationId, line.productId, businessDate, Number(line.quantity), counterpartyId);
        if (found) {
          price = new Decimal(found.price.toString());
          priceListId = found.priceListId;
          productPriceId = found.id;
        } else {
          // No explicit price and no PURCHASE price list match — leave the
          // line's price blank rather than blocking the whole document
          // (typically a line auto-filled from a Purchase Requirement,
          // which never carries pricing). PurchaseOrderPostingHandler is
          // the actual gate, at confirmation.
          price = null;
        }
      }

      let taxRate: Decimal;
      if (price == null) {
        // No tax preview without a price to apply it to — the line stays
        // fully incomplete until a price is entered.
        taxRate = new Decimal(0);
      } else if (line.taxRate !== undefined) {
        taxRate = new Decimal(line.taxRate.toString());
        if (!taxRate.isFinite() || taxRate.lt(0)) throw new ValidationAppError('Line tax rate must not be negative');
      } else {
        const preview = await this.taxCalculation.calculateLine({
          tenantId,
          organizationId,
          businessDate,
          taxPointDate: businessDate,
          operationType: 'PURCHASE',
          taxCategoryCode: DEFAULT_TAX_CATEGORY,
          taxpayerSide: 'BUYER',
        }, { amount: quantity.mul(price), priceIncludesTax });
        taxRate = preview.rate;
      }

      // Approval gate (closes a direct-API bypass of
      // ProcurementPlanningService.createPurchaseOrderFromRequirements'
      // own approval check): a line sourced from a Purchase Requirement
      // may only be used once that requirement is fully approved,
      // regardless of which endpoint the caller went through.
      if (line.requirementLineId) {
        const requirementLine = await this.prisma.purchaseRequirementLine.findFirst({
          where: { id: line.requirementLineId, tenantId },
          include: { purchaseRequirement: true },
        });
        if (!requirementLine) throw new ValidationAppError('Requirement line not found');
        if (requirementLine.purchaseRequirement.approvalStatus !== 'APPROVED') {
          throw new ValidationAppError(`Requirement ${requirementLine.purchaseRequirement.number ?? requirementLine.purchaseRequirement.id} is not approved yet`);
        }
      }

      // Supplier product code snapshot (spec section 130): captured at
      // order time even though the mapping master data may change later.
      const mapping = await this.prisma.supplierProductCode.findFirst({ where: { organizationId, counterpartyId, productId: line.productId, active: true } });

      const computed = price == null
        ? { quantity, price: null as Decimal | null, taxRate: new Decimal(0), lineTotal: new Decimal(0), taxAmount: new Decimal(0), lineTotalWithTax: new Decimal(0) }
        : computeLineTotals(quantity, price, taxRate, priceIncludesTax);
      resolved.push({
        productId: line.productId,
        unitId: line.unitId,
        ...computed,
        priceListId,
        productPriceId,
        isService: line.isService ?? false,
        warehouseId: line.warehouseId,
        expectedDeliveryDate: line.expectedDeliveryDate ? new Date(line.expectedDeliveryDate) : undefined,
        supplierProductCode: mapping?.supplierCode ?? null,
        requirementLineId: line.requirementLineId,
        description: line.description,
        deliverySchedule: line.deliverySchedule?.map((d) => ({ plannedDate: new Date(d.plannedDate), quantity: new Decimal(d.quantity.toString()), warehouseId: d.warehouseId })),
      });
    }
    return resolved;
  }

  private async createLines(tx: any, tenantId: string, purchaseOrderId: string, lines: ResolvedPOLine[], userId: string) {
    for (const [index, line] of lines.entries()) {
      const created = await tx.purchaseOrderLine.create({
        data: {
          tenantId,
          purchaseOrderId,
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
          isService: line.isService,
          warehouseId: line.warehouseId,
          expectedDeliveryDate: line.expectedDeliveryDate,
          supplierProductCode: line.supplierProductCode,
          requirementLineId: line.requirementLineId,
          description: line.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      if (line.deliverySchedule?.length) {
        for (const d of line.deliverySchedule) {
          await tx.purchaseDeliveryScheduleLine.create({
            data: { tenantId, purchaseOrderLineId: created.id, plannedDate: d.plannedDate, quantity: d.quantity, warehouseId: d.warehouseId },
          });
        }
      }
    }
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PURCHASE_ORDER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PURCHASE_ORDER_TYPE, documentType: PURCHASE_ORDER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
