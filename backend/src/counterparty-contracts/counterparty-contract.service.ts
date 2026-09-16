import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CounterpartyService } from '../counterparty-pricing/counterparty.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRuleNotFoundError, TaxRuleAmbiguousError } from '../common/errors/app-error';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRED', 'CANCELLED'];
const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';
const VAT_EXEMPT_CATEGORY = 'VAT_EXEMPT';

function round2(v: Decimal): Decimal {
  return new Decimal(v.toFixed(2));
}

/**
 * CounterpartyContract service ("Kontragentlər" module, spec sections 5,
 * 8, 10-14). Plain CRUD + a bespoke approval gate, same non-posting
 * shape as PurchaseRequirement/CounterpartyService — a contract never
 * touches GL or inventory. Extended (spec sections 10-14) with
 * commercial/delivery terms, nomenclature lines priced through the real
 * Tax Engine (never a hardcoded rate — see resolveLineTax), and
 * creation from a confirmed PurchaseOrder.
 */
@Injectable()
export class CounterpartyContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly counterparties: CounterpartyService,
    private readonly taxCalculation: TaxCalculationService,
  ) {}

  async listForCounterparty(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.counterparties.get(tenantId, membershipId, organizationId, counterpartyId);
    return this.prisma.counterpartyContract.findMany({ where: { counterpartyId, organizationId }, orderBy: { createdAt: 'desc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.prisma.counterpartyContract.findFirst({
      where: { id, organizationId },
      include: {
        amendments: { orderBy: { createdAt: 'desc' } },
        lines: { orderBy: { position: 'asc' } },
        paymentInstallments: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!contract) throw new NotFoundAppError('CounterpartyContract', id);
    return { ...contract, lines: await this.attachSourceChain(tenantId, (contract as any).lines) };
  }

  /** Attaches the full "Müqavilə sətri -> Alış sifarişi sətri -> Alış
   * tələbi sətri" traceability chain to each contract line for display —
   * one batched query per hop rather than per-line, since a contract can
   * have many lines. */
  private async attachSourceChain(tenantId: string, lines: any[]) {
    const poLineIds = lines.map((l) => l.sourceOrderLineId).filter((v): v is string => !!v);
    if (poLineIds.length === 0) return lines;

    const poLines = await this.prisma.purchaseOrderLine.findMany({ where: { id: { in: poLineIds }, tenantId } });
    const poIds = Array.from(new Set(poLines.map((l) => l.purchaseOrderId)));
    const orders = await this.prisma.purchaseOrder.findMany({ where: { id: { in: poIds }, tenantId } });
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const reqLineIds = poLines.map((l) => l.requirementLineId).filter((v): v is string => !!v);
    const reqLines = reqLineIds.length > 0 ? await this.prisma.purchaseRequirementLine.findMany({ where: { id: { in: reqLineIds }, tenantId } }) : [];
    const reqIds = Array.from(new Set(reqLines.map((l) => l.purchaseRequirementId)));
    const requirements = reqIds.length > 0 ? await this.prisma.purchaseRequirement.findMany({ where: { id: { in: reqIds }, tenantId } }) : [];
    const requirementById = new Map(requirements.map((r) => [r.id, r]));
    const reqLineById = new Map(reqLines.map((l) => [l.id, l]));
    const poLineById = new Map(poLines.map((l) => [l.id, l]));

    return lines.map((line) => {
      if (!line.sourceOrderLineId) return line;
      const poLine = poLineById.get(line.sourceOrderLineId);
      if (!poLine) return line;
      const order = orderById.get(poLine.purchaseOrderId);
      const reqLine = poLine.requirementLineId ? reqLineById.get(poLine.requirementLineId) : undefined;
      const requirement = reqLine ? requirementById.get(reqLine.purchaseRequirementId) : undefined;
      return {
        ...line,
        sourceChain: {
          purchaseOrderId: order?.id ?? poLine.purchaseOrderId,
          purchaseOrderNumber: order?.number ?? null,
          purchaseOrderLineId: poLine.id,
          purchaseRequirementId: requirement?.id ?? null,
          purchaseRequirementNumber: requirement?.number ?? null,
          purchaseRequirementLineId: reqLine?.id ?? null,
        },
      };
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.counterparties.get(tenantId, membershipId, organizationId, counterpartyId);

    const existing = await this.prisma.counterpartyContract.findUnique({
      where: { counterpartyId_number: { counterpartyId, number: input.number } },
    });
    if (existing) throw new ConflictAppError(`A contract with number ${input.number} already exists for this counterparty`);

    if (input.currencyId) await this.assertCurrency(input.currencyId);
    if (input.responsiblePersonId) await this.assertResponsiblePerson(tenantId, input.responsiblePersonId);

    const contract = await this.prisma.counterpartyContract.create({
      data: {
        tenantId, organizationId, counterpartyId, createdBy: userId, updatedBy: userId,
        number: input.number, subject: input.subject, contractType: input.contractType,
        signedDate: input.signedDate ? new Date(input.signedDate) : undefined,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        amount: input.amount != null ? new Decimal(input.amount.toString()) : undefined,
        currencyId: input.currencyId, paymentTerms: input.paymentTerms,
        responsiblePersonId: input.responsiblePersonId, notes: input.notes,
        hasAdvance: input.hasAdvance ?? false,
        advancePercent: input.advancePercent != null ? new Decimal(input.advancePercent.toString()) : undefined,
        remainingPaymentDueDays: input.remainingPaymentDueDays,
        deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : undefined,
        deliveryTermDays: input.deliveryTermDays,
        deliveryAddress: input.deliveryAddress,
        deliveryTerms: input.deliveryTerms,
        warrantyPeriod: input.warrantyPeriod,
        penaltyTerms: input.penaltyTerms,
        otherTerms: input.otherTerms,
        priceIncludesTax: input.priceIncludesTax ?? false,
        limitAmount: input.limitAmount != null ? new Decimal(input.limitAmount.toString()) : undefined,
        limitPolicy: input.limitPolicy ?? undefined,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_CREATED', entityType: 'CounterpartyContract',
      entityId: contract.id, action: 'CREATE', userId, newValues: { number: contract.number, counterpartyId },
    });
    return contract;
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.currencyId) await this.assertCurrency(patch.currencyId);
    if (patch.responsiblePersonId) await this.assertResponsiblePerson(tenantId, patch.responsiblePersonId);

    const dateFields = ['signedDate', 'startDate', 'endDate', 'deliveryDate'];
    const decimalFields = ['amount', 'advancePercent', 'limitAmount'];
    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    for (const k of Object.keys(patch)) {
      if (dateFields.includes(k) && patch[k] !== undefined) updateData[k] = patch[k] ? new Date(patch[k]) : null;
      else if (decimalFields.includes(k) && patch[k] !== undefined) updateData[k] = patch[k] != null ? new Decimal(patch[k].toString()) : null;
      else if (patch[k] !== undefined) updateData[k] = patch[k];
    }
    const result = await this.prisma.counterpartyContract.updateMany({ where: { id, organizationId, version: expectedVersion }, data: updateData });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_UPDATED', entityType: 'CounterpartyContract',
      entityId: id, action: 'UPDATE', userId, newValues: patch,
    });

    // A tax-point-relevant field changed (dates, price-includes-tax) — the
    // resolved rate for every line may now be different (spec section
    // 12: "sənədin tarixinə uyğun qüvvədə olan vergi dərəcəsi seçilsin").
    if (patch.signedDate !== undefined || patch.startDate !== undefined || patch.priceIncludesTax !== undefined) {
      await this.recalculateContract(tenantId, id, userId);
    }
    return this.get(tenantId, membershipId, organizationId, id);
  }

  // -- Nomenclature lines (spec sections 11-13) --------------------------------

  /**
   * "Müqavilədə alış sifarişindən kənar yeni nomenklaturanın əl ilə əlavə
   * edilməsinə icazə verilməsin" — every contract must have a source PO
   * (spec section 11), and every line must trace back to one of ITS
   * lines. This is not a free-form "add any product" command any more:
   * `sourceOrderLineId` is mandatory, must belong to the contract's own
   * `sourcePurchaseOrderId`, and product/unit/price are always derived
   * from that PO line — a client-supplied productId/unitId/price is
   * ignored, never trusted. Effectively "bring back a PO line that was
   * removed (or never fully pulled in)"; quantity defaults to the PO
   * line's live remaining quantity and is capped by it.
   */
  async addLine(tenantId: string, membershipId: string, organizationId: string, contractId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.requireEditable(tenantId, membershipId, organizationId, contractId);
    if (!contract.sourcePurchaseOrderId) throw new ValidationAppError('Select a source purchase order before adding nomenclature lines');
    if (!input.sourceOrderLineId) throw new ValidationAppError('A contract line must reference a purchase order line — manual nomenclature entry is not allowed');

    const poLine = await this.prisma.purchaseOrderLine.findFirst({ where: { id: input.sourceOrderLineId, tenantId, purchaseOrderId: contract.sourcePurchaseOrderId } });
    if (!poLine) throw new ValidationAppError('That line does not belong to this contract\'s source purchase order');

    const remaining = await this.remainingForPurchaseOrderLine(tenantId, poLine.id);
    const quantity = input.quantity != null ? new Decimal(input.quantity.toString()) : remaining;
    if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationAppError('Line quantity must be positive');
    if (quantity.gt(remaining)) throw new ValidationAppError(`Requested quantity ${quantity.toString()} exceeds the purchase order line's remaining quantity ${remaining.toString()}`);

    const maxPosition = await this.prisma.counterpartyContractLine.aggregate({ where: { contractId }, _max: { position: true } });

    const line = await this.prisma.counterpartyContractLine.create({
      data: {
        tenantId, contractId, position: (maxPosition._max.position ?? -1) + 1,
        productId: poLine.productId, description: poLine.description, quantity,
        unitId: poLine.unitId, unitPrice: poLine.price ?? 0, discountPercent: 0,
        sourceOrderLineId: poLine.id,
        sourcePoTaxRatePercent: poLine.taxRate, sourcePoTaxAmount: poLine.taxAmount,
      },
    });

    await this.prisma.counterpartyContract.update({ where: { id: contractId }, data: { linesDirty: true } });
    await this.recalculateLine(tenantId, contract.organizationId, contract.counterpartyId, line.id, contract, userId);
    await this.recalculateContractTotals(tenantId, contractId);
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_LINE_ADDED', entityType: 'CounterpartyContract',
      entityId: contractId, action: 'CREATE', userId, newValues: { lineId: line.id, productId: poLine.productId, quantity: quantity.toString(), sourceOrderLineId: poLine.id },
    });
    return this.prisma.counterpartyContractLine.findUnique({ where: { id: line.id } });
  }

  async updateLine(tenantId: string, membershipId: string, organizationId: string, contractId: string, lineId: string, userId: string, expectedVersion: number, patch: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.requireEditable(tenantId, membershipId, organizationId, contractId);
    const before = await this.prisma.counterpartyContractLine.findFirst({ where: { id: lineId, contractId } });
    if (!before) throw new NotFoundAppError('CounterpartyContractLine', lineId);

    // Quantity may only be REDUCED to fit the source PO line's remaining
    // quantity — never increased beyond it (spec section 11: "yalnız
    // müqaviləyə daxil ediləcək miqdar ... qalıq miqdarı keçməmək şərti
    // ilə azaldıla bilsin"). Name/code/unit come from the PO line and are
    // never editable here — only pricing and quantity are.
    if (patch.quantity !== undefined && before.sourceOrderLineId) {
      const remainingExcludingThisLine = (await this.remainingForPurchaseOrderLine(tenantId, before.sourceOrderLineId)).plus(before.quantity.toString());
      const requested = new Decimal(patch.quantity.toString());
      if (!requested.isFinite() || requested.lte(0)) throw new ValidationAppError('Line quantity must be positive');
      if (requested.gt(remainingExcludingThisLine)) {
        throw new ValidationAppError(`Requested quantity ${requested.toString()} exceeds the purchase order line's remaining quantity ${remainingExcludingThisLine.toString()}`);
      }
    }

    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    if (patch.quantity !== undefined) updateData.quantity = new Decimal(patch.quantity.toString());
    if (patch.unitPrice !== undefined) updateData.unitPrice = new Decimal(patch.unitPrice.toString());
    if (patch.discountPercent !== undefined) updateData.discountPercent = new Decimal(patch.discountPercent.toString());
    if (patch.description !== undefined) updateData.description = patch.description;
    // Note: productId/unitId are intentionally never accepted here — the
    // nomenclature name, code, and unit always come from the source PO
    // line and cannot be changed on the contract (spec section 11).

    const result = await this.prisma.counterpartyContractLine.updateMany({ where: { id: lineId, contractId, version: expectedVersion }, data: updateData });
    if (result.count === 0) throw new ConcurrencyConflictError();

    // "Alış sifarişindən gətirilmiş məlumatlar müqavilədə redaktə edilərsə,
    // ilkin və dəyişdirilmiş dəyərlər tarixçədə saxlanılsın" (spec section
    // 11) — a PO-sourced line's own history keeps BOTH values, not just
    // the fact that something changed.
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const key of ['quantity', 'unitPrice', 'discountPercent', 'description']) {
      if (patch[key] !== undefined) {
        oldValues[key] = (before as any)[key]?.toString?.() ?? (before as any)[key];
        newValues[key] = patch[key];
      }
    }
    await this.audit.record({
      tenantId, eventType: before.sourceOrderLineId ? 'COUNTERPARTY_CONTRACT_LINE_PO_VALUE_CHANGED' : 'COUNTERPARTY_CONTRACT_LINE_UPDATED',
      entityType: 'CounterpartyContract', entityId: contractId, action: 'UPDATE', userId, oldValues, newValues,
      metadata: { lineId, sourceOrderLineId: before.sourceOrderLineId },
    });

    await this.prisma.counterpartyContract.update({ where: { id: contractId }, data: { linesDirty: true } });
    await this.recalculateLine(tenantId, contract.organizationId, contract.counterpartyId, lineId, contract, userId);
    await this.recalculateContractTotals(tenantId, contractId);
    return this.prisma.counterpartyContractLine.findUnique({ where: { id: lineId } });
  }

  async removeLine(tenantId: string, membershipId: string, organizationId: string, contractId: string, lineId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.requireEditable(tenantId, membershipId, organizationId, contractId);
    const line = await this.prisma.counterpartyContractLine.findFirst({ where: { id: lineId, contractId } });
    if (!line) throw new NotFoundAppError('CounterpartyContractLine', lineId);

    await this.prisma.counterpartyContractLine.delete({ where: { id: lineId } });
    await this.prisma.counterpartyContract.update({ where: { id: contractId }, data: { linesDirty: true } });
    await this.recalculateContractTotals(tenantId, contractId);
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_LINE_REMOVED', entityType: 'CounterpartyContract',
      entityId: contractId, action: 'DELETE', userId, oldValues: { lineId, productId: line.productId, quantity: line.quantity.toString() },
    });
    return { removed: true };
  }

  /** Resolves this line's tax (spec section 12) through the real Tax
   * Engine — never a hardcoded rate. `taxCategoryCode` comes from
   * ProductTaxProfile when configured (same precedent Sales/Purchase
   * Invoice posting already use), else from the counterparty's own VAT-
   * payer status (not a VAT payer -> VAT_EXEMPT), else the platform
   * default. A missing/ambiguous rule for the document's date never
   * throws here — it's recorded on the line as `taxCalculationError` so
   * the line still saves (DRAFT stays editable) and the approval gate
   * is what actually blocks (spec section 14). */
  private async recalculateLine(tenantId: string, organizationId: string, counterpartyId: string, lineId: string, contract: { id?: string; priceIncludesTax: boolean; signedDate: Date | null; startDate: Date | null }, userId?: string) {
    const line = await this.prisma.counterpartyContractLine.findUnique({ where: { id: lineId } });
    if (!line) return;
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId } });

    const lineAmount = round2(new Decimal(line.quantity.toString()).mul(line.unitPrice.toString()));
    const discountAmount = round2(lineAmount.mul(line.discountPercent.toString()).div(100));
    const amountForTax = lineAmount.minus(discountAmount);
    const businessDate = contract.signedDate ?? contract.startDate ?? new Date();

    const taxCategoryCode = await this.resolveTaxCategoryCode(tenantId, organizationId, line.productId, counterparty, businessDate);

    try {
      const result = await this.taxCalculation.calculateLine(
        {
          tenantId, organizationId, businessDate, taxPointDate: businessDate,
          operationType: 'PURCHASE', taxCategoryCode, taxpayerSide: 'BUYER',
          counterpartyId, productId: line.productId,
        },
        { sourceLineId: line.id, amount: amountForTax, priceIncludesTax: contract.priceIncludesTax },
      );
      const newTaxAmount = round2(result.taxAmount);

      // The counterparty's tax status (rather than the PO's own snapshot
      // tax) is what actually drives this recalculation — if it lands on
      // a different rate than the source PO line had, surface it rather
      // than silently overwrite (spec: PO-vs-contract tax difference
      // warning, kept in history).
      const taxMismatch = line.sourcePoTaxAmount != null && !round2(new Decimal(line.sourcePoTaxAmount.toString())).equals(newTaxAmount);
      if (taxMismatch && userId && !line.taxMismatch) {
        await this.audit.record({
          tenantId, eventType: 'COUNTERPARTY_CONTRACT_LINE_TAX_MISMATCH', entityType: 'CounterpartyContract',
          entityId: contract.id ?? line.contractId, action: 'UPDATE', userId,
          oldValues: { sourcePoTaxRatePercent: line.sourcePoTaxRatePercent?.toString() ?? null, sourcePoTaxAmount: line.sourcePoTaxAmount?.toString() ?? null },
          newValues: { taxRatePercent: result.rate.toString(), taxAmount: newTaxAmount.toString() },
          metadata: { lineId },
        });
      }

      await this.prisma.counterpartyContractLine.update({
        where: { id: lineId },
        data: {
          lineAmount, discountAmount, taxBase: round2(result.taxableBase), taxCategoryCode,
          taxRatePercent: result.rate, taxAmount: newTaxAmount, lineTotal: round2(result.grossAmount),
          taxCalculationError: null, taxMismatch,
        },
      });
    } catch (err) {
      const message = err instanceof TaxRuleNotFoundError || err instanceof TaxRuleAmbiguousError ? err.message : 'Tax calculation failed';
      await this.prisma.counterpartyContractLine.update({
        where: { id: lineId },
        data: { lineAmount, discountAmount, taxBase: lineAmount.minus(discountAmount), taxCategoryCode, taxRatePercent: null, taxAmount: null, lineTotal: null, taxCalculationError: message },
      });
    }
  }

  /** Recomputes every line (used when a tax-point-relevant contract field
   * changes) then the header totals. */
  private async recalculateContract(tenantId: string, contractId: string, userId?: string) {
    const contract = await this.prisma.counterpartyContract.findUnique({ where: { id: contractId }, include: { lines: true } });
    if (!contract) return;
    for (const line of contract.lines) {
      await this.recalculateLine(tenantId, contract.organizationId, contract.counterpartyId, line.id, contract, userId);
    }
    await this.recalculateContractTotals(tenantId, contractId);
  }

  /** Header totals (spec section 13) — subtotal/discount/tax/grand total
   * always derived live from the lines, never hand-entered; `amount`
   * IS the grand (tax-included) total, kept structurally in sync so the
   * approval gate's "total equals sum of lines" check can never
   * realistically fail. Advance amount auto-recomputes from the new
   * grand total UNLESS a user has manually overridden it. */
  private async recalculateContractTotals(tenantId: string, contractId: string) {
    const contract = await this.prisma.counterpartyContract.findUnique({ where: { id: contractId }, include: { lines: true } });
    if (!contract) return;

    let subtotal = new Decimal(0);
    let totalDiscount = new Decimal(0);
    let totalTax = new Decimal(0);
    let grandTotal = new Decimal(0);
    for (const line of contract.lines) {
      subtotal = subtotal.plus(line.taxBase.toString());
      totalDiscount = totalDiscount.plus(line.discountAmount.toString());
      if (line.taxAmount != null) totalTax = totalTax.plus(line.taxAmount.toString());
      if (line.lineTotal != null) grandTotal = grandTotal.plus(line.lineTotal.toString());
    }

    let advanceAmount = contract.advanceAmount;
    if (contract.hasAdvance && contract.advancePercent != null && !contract.advanceAmountManual) {
      advanceAmount = round2(grandTotal.mul(contract.advancePercent.toString()).div(100));
    }
    const remainingPayableAmount = grandTotal.minus(advanceAmount ? new Decimal(advanceAmount.toString()) : 0);

    await this.prisma.counterpartyContract.update({
      where: { id: contractId },
      data: {
        subtotal: round2(subtotal), totalDiscount: round2(totalDiscount), totalTax: round2(totalTax),
        amount: contract.lines.length > 0 ? round2(grandTotal) : contract.amount,
        advanceAmount: advanceAmount ?? undefined,
        remainingPayableAmount: contract.lines.length > 0 ? round2(remainingPayableAmount) : contract.remainingPayableAmount,
      },
    });
  }

  private async resolveTaxCategoryCode(tenantId: string, organizationId: string, productId: string, counterparty: { vatPayer: boolean } | null, businessDate: Date): Promise<string> {
    const profile = await this.prisma.productTaxProfile.findFirst({
      where: {
        tenantId, productId, active: true,
        validFrom: { lte: businessDate },
        OR: [{ validTo: null }, { validTo: { gte: businessDate } }],
        AND: [{ OR: [{ organizationId }, { organizationId: null }] }],
      },
      include: { taxCategory: true },
      orderBy: { validFrom: 'desc' },
    });
    if (profile) return profile.taxCategory.code;
    if (counterparty && counterparty.vatPayer === false) return VAT_EXEMPT_CATEGORY;
    return DEFAULT_TAX_CATEGORY;
  }

  // -- Advance (spec section 10) -----------------------------------------------

  /** Manual advance-amount override (spec section 10: "İstifadəçinin
   * səlahiyyəti olduqda hesablanmış məbləği əl ilə dəyişmək mümkün olsun
   * və bu dəyişiklik tarixçədə saxlanılsın") — permission-gated at the
   * controller (`counterparty.contract.advance.override` maps to
   * `contract.edit` here, same as every other field edit). Passing
   * `advanceAmount: null` clears the override and reverts to auto-calc. */
  async setAdvance(tenantId: string, membershipId: string, organizationId: string, contractId: string, userId: string, expectedVersion: number, input: { hasAdvance?: boolean; advancePercent?: number | null; advanceAmount?: number | null }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.get(tenantId, membershipId, organizationId, contractId);
    if (contract.status === 'APPROVED' || contract.status === 'ACTIVE') throw new ValidationAppError('Unapprove the contract before changing its advance terms');

    const oldValues = { advancePercent: contract.advancePercent?.toString() ?? null, advanceAmount: contract.advanceAmount?.toString() ?? null, advanceAmountManual: contract.advanceAmountManual };
    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    if (input.hasAdvance !== undefined) updateData.hasAdvance = input.hasAdvance;
    if (input.advancePercent !== undefined) updateData.advancePercent = input.advancePercent != null ? new Decimal(input.advancePercent.toString()) : null;

    if (input.advanceAmount !== undefined) {
      // An explicit amount is always a deliberate manual override.
      updateData.advanceAmount = input.advanceAmount != null ? new Decimal(input.advanceAmount.toString()) : null;
      updateData.advanceAmountManual = input.advanceAmount != null;
    } else if (input.advancePercent !== undefined) {
      // Changing the percent alone re-enables auto-calculation.
      updateData.advanceAmountManual = false;
    }

    const result = await this.prisma.counterpartyContract.updateMany({ where: { id: contractId, organizationId, version: expectedVersion }, data: updateData });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.recalculateContractTotals(tenantId, contractId);
    const after = await this.prisma.counterpartyContract.findUnique({ where: { id: contractId } });
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_ADVANCE_CHANGED', entityType: 'CounterpartyContract', entityId: contractId, action: 'UPDATE', userId,
      oldValues, newValues: { advancePercent: after?.advancePercent?.toString() ?? null, advanceAmount: after?.advanceAmount?.toString() ?? null, advanceAmountManual: after?.advanceAmountManual },
    });
    return this.get(tenantId, membershipId, organizationId, contractId);
  }

  // -- Payment schedule (spec section 10) --------------------------------------

  /** Generates installments from percentages of the CURRENT grand total,
   * rounding the residual into the last installment — same convention
   * PurchaseOrderPaymentScheduleService already uses. */
  async generatePaymentSchedule(tenantId: string, membershipId: string, organizationId: string, contractId: string, userId: string, installments: { dueDate: string; basis: string; percentage?: number; amount?: number }[]) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.get(tenantId, membershipId, organizationId, contractId);
    if (!contract.amount) throw new ValidationAppError('Add contract lines (or an amount) before generating a payment schedule');
    const total = new Decimal(contract.amount.toString());

    await this.prisma.counterpartyContractPaymentInstallment.deleteMany({ where: { contractId } });

    let allocated = new Decimal(0);
    const rows: { dueDate: Date; basis: string; percentage?: Decimal; amount: Decimal }[] = [];
    for (const [index, inst] of installments.entries()) {
      const isLast = index === installments.length - 1;
      let amount: Decimal;
      if (isLast) {
        amount = round2(total.minus(allocated));
      } else if (inst.amount != null) {
        amount = round2(new Decimal(inst.amount.toString()));
      } else {
        amount = round2(total.mul((inst.percentage ?? 0).toString()).div(100));
      }
      allocated = allocated.plus(amount);
      rows.push({ dueDate: new Date(inst.dueDate), basis: inst.basis, percentage: inst.percentage != null ? new Decimal(inst.percentage.toString()) : undefined, amount });
    }

    for (const [index, row] of rows.entries()) {
      await this.prisma.counterpartyContractPaymentInstallment.create({
        data: { tenantId, contractId, sequence: index, dueDate: row.dueDate, basis: row.basis, percentage: row.percentage, amount: row.amount, currencyId: contract.currencyId },
      });
    }
    await this.audit.record({ tenantId, eventType: 'COUNTERPARTY_CONTRACT_PAYMENT_SCHEDULE_SET', entityType: 'CounterpartyContract', entityId: contractId, action: 'UPDATE', userId, newValues: { count: rows.length } });
    return this.prisma.counterpartyContractPaymentInstallment.findMany({ where: { contractId }, orderBy: { sequence: 'asc' } });
  }

  // -- Create from a confirmed Purchase Order (spec section 11) ---------------

  async remainingForPurchaseOrderLine(tenantId: string, purchaseOrderLineId: string): Promise<Decimal> {
    const poLine = await this.prisma.purchaseOrderLine.findFirst({ where: { id: purchaseOrderLineId, tenantId } });
    if (!poLine) throw new NotFoundAppError('PurchaseOrderLine', purchaseOrderLineId);
    const contracted = await this.prisma.counterpartyContractLine.aggregate({
      where: { tenantId, sourceOrderLineId: purchaseOrderLineId, contract: { status: { not: 'CANCELLED' } } },
      _sum: { quantity: true },
    });
    const remaining = new Decimal(poLine.quantity.toString())
      .minus(poLine.cancelledQuantity.toString())
      .minus(new Decimal((contracted._sum.quantity ?? 0).toString()));
    return remaining;
  }

  /** Per-line remaining-to-contract quantities for a whole Purchase Order
   * — the "Create Contract from PO" panel's own pre-fill needs this
   * BEFORE the user ever submits, otherwise it can only guess (and
   * guessing wrong — e.g. defaulting to the PO line's full ordered
   * quantity when an earlier contract has already claimed all of it —
   * is exactly the confusing late "exceeds remaining quantity 0" error
   * this fixes). The server, via `remainingForPurchaseOrderLine`, is
   * always the actual source of truth; this just exposes it up front. */
  async remainingForPurchaseOrder(tenantId: string, purchaseOrderId: string): Promise<{ purchaseOrderLineId: string; remaining: string }[]> {
    const lines = await this.prisma.purchaseOrderLine.findMany({ where: { tenantId, purchaseOrderId }, orderBy: { position: 'asc' } });
    const result = [];
    for (const line of lines) {
      const remaining = await this.remainingForPurchaseOrderLine(tenantId, line.id);
      result.push({ purchaseOrderLineId: line.id, remaining: remaining.toString() });
    }
    return result;
  }

  /** Creates a contract from a CONFIRMED (posted) Purchase Order (spec
   * section 11): counterparty, product/description/quantity/unit/price/
   * currency are copied straight onto contract lines, each keeping
   * `sourceOrderLineId` so both directions of traceability work — "hansı
   * alış sifarişi sətrindən yarandığı müəyyən edilə bilsin". Requesting
   * more than a PO line's live remaining quantity (across every
   * non-cancelled contract already drawing on it) is rejected —
   * "səhvən bir neçə aktiv müqaviləyə tam həcmdə əlavə edilməsi"
   * is exactly what `remainingForPurchaseOrderLine` prevents. Omitting
   * `lines` takes every PO line at its full remaining quantity. */
  async createFromPurchaseOrder(tenantId: string, membershipId: string, organizationId: string, userId: string, input: { purchaseOrderId: string; number: string; subject?: string; lines?: { purchaseOrderLineId: string; quantity?: number }[] }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!po) throw new NotFoundAppError('PurchaseOrder', input.purchaseOrderId);
    if (po.postingStatus !== 'POSTED') throw new ValidationAppError('Only a confirmed (posted) purchase order can be used to create a contract');
    // Defense in depth — PurchaseOrderPostingHandler already refuses to
    // confirm a PO with any blank-price line, so this can only trip on
    // stale/tampered data, never through the normal UI flow.
    if (po.lines.some((l) => l.price == null)) {
      throw new ValidationAppError('This purchase order has lines with no price — enter every missing price before creating a contract from it');
    }

    const existing = await this.prisma.counterpartyContract.findUnique({ where: { counterpartyId_number: { counterpartyId: po.counterpartyId, number: input.number } } });
    if (existing) throw new ConflictAppError(`A contract with number ${input.number} already exists for this counterparty`);

    const requested = input.lines && input.lines.length > 0
      ? input.lines
      : po.lines.map((l) => ({ purchaseOrderLineId: l.id, quantity: undefined }));

    const resolvedLines: { poLine: (typeof po.lines)[number]; quantity: Decimal }[] = [];
    for (const req of requested) {
      const poLine = po.lines.find((l) => l.id === req.purchaseOrderLineId);
      if (!poLine) throw new ValidationAppError(`Purchase order line not found: ${req.purchaseOrderLineId}`);
      const remaining = await this.remainingForPurchaseOrderLine(tenantId, poLine.id);
      const quantity = req.quantity != null ? new Decimal(req.quantity.toString()) : remaining;
      if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationAppError('Contracted quantity must be positive');
      if (quantity.gt(remaining)) {
        throw new ValidationAppError(`Requested quantity ${quantity.toString()} exceeds the purchase order line's remaining quantity ${remaining.toString()}`);
      }
      resolvedLines.push({ poLine, quantity });
    }
    if (resolvedLines.length === 0) throw new ValidationAppError('No purchase order lines to contract');

    const contract = await this.prisma.counterpartyContract.create({
      data: {
        tenantId, organizationId, counterpartyId: po.counterpartyId, createdBy: userId, updatedBy: userId,
        number: input.number, subject: input.subject ?? `Contract for ${po.number ?? po.id}`,
        currencyId: po.currencyId, priceIncludesTax: po.priceIncludesTax,
        sourcePurchaseOrderId: po.id,
      },
    });

    for (const [index, { poLine, quantity }] of resolvedLines.entries()) {
      const line = await this.prisma.counterpartyContractLine.create({
        data: {
          tenantId, contractId: contract.id, position: index,
          productId: poLine.productId, description: poLine.description, quantity,
          unitId: poLine.unitId, unitPrice: poLine.price ?? 0, discountPercent: 0,
          sourceOrderLineId: poLine.id,
          // Snapshot of the PO's own tax, compared against the live
          // recalculation below (and every later recalc) to surface a
          // divergence to the user (spec: PO-vs-contract tax difference).
          sourcePoTaxRatePercent: poLine.taxRate, sourcePoTaxAmount: poLine.taxAmount,
        },
      });
      await this.recalculateLine(tenantId, organizationId, po.counterpartyId, line.id, contract, userId);
    }
    await this.recalculateContractTotals(tenantId, contract.id);

    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_CREATED_FROM_PURCHASE_ORDER', entityType: 'CounterpartyContract',
      entityId: contract.id, action: 'CREATE', userId,
      newValues: { number: contract.number, purchaseOrderId: po.id, lineCount: resolvedLines.length },
    });
    return this.get(tenantId, membershipId, organizationId, contract.id);
  }

  /** Lists POSTED purchase orders for this counterparty that still have
   * at least one line with a positive remaining (uncontracted) quantity
   * and no blank-price line — i.e. eligible sources for the mandatory
   * "Alış sifarişini seç" field on the contract form. */
  async eligiblePurchaseOrdersForCounterparty(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { tenantId, organizationId, counterpartyId, postingStatus: 'POSTED' },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    const eligible: typeof orders = [];
    for (const order of orders) {
      if (order.lines.some((l) => l.price == null)) continue;
      let anyRemaining = false;
      for (const line of order.lines) {
        if ((await this.remainingForPurchaseOrderLine(tenantId, line.id)).gt(0)) { anyRemaining = true; break; }
      }
      if (anyRemaining) eligible.push(order);
    }
    return eligible;
  }

  /** Changes a DRAFT contract's source purchase order (spec: "Alış
   * sifarişinin seçimi dəyişdirildikdə əvvəl gətirilmiş nomenklatura
   * məlumatları silinərək yeni seçilmiş alış sifarişinin məlumatları ilə
   * əvəz edilsin") — every existing line is discarded and replaced with a
   * fresh pull from the new PO's remaining quantities. The frontend is
   * responsible for warning the user first when `linesDirty` is true (the
   * contract has lines that were hand-edited since the last PO pull);
   * this command itself always proceeds once called — it is the
   * authoritative "replace" action, not a second confirmation gate. */
  async setSourcePurchaseOrder(tenantId: string, membershipId: string, organizationId: string, contractId: string, userId: string, expectedVersion: number, purchaseOrderId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.requireEditable(tenantId, membershipId, organizationId, contractId);
    if (contract.version !== expectedVersion) throw new ConcurrencyConflictError();

    const po = await this.prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!po) throw new NotFoundAppError('PurchaseOrder', purchaseOrderId);
    if (po.postingStatus !== 'POSTED') throw new ValidationAppError('Only a confirmed (posted) purchase order can be selected');
    if (po.counterpartyId !== contract.counterpartyId) throw new ValidationAppError('The purchase order must belong to this contract\'s counterparty');
    if (po.lines.some((l) => l.price == null)) {
      throw new ValidationAppError('This purchase order has lines with no price — enter every missing price before selecting it');
    }

    const resolvedLines: { poLine: (typeof po.lines)[number]; quantity: Decimal }[] = [];
    for (const poLine of po.lines) {
      // Excludes this same contract's own current allocation on that PO
      // line (about to be deleted) from "already contracted" so switching
      // away and back doesn't self-block.
      const remaining = (await this.remainingForPurchaseOrderLine(tenantId, poLine.id));
      if (remaining.gt(0)) resolvedLines.push({ poLine, quantity: remaining });
    }
    if (resolvedLines.length === 0) throw new ValidationAppError('The selected purchase order has no remaining quantity to contract');

    await this.prisma.counterpartyContractLine.deleteMany({ where: { contractId } });
    const result = await this.prisma.counterpartyContract.updateMany({
      where: { id: contractId, organizationId, version: expectedVersion },
      data: {
        sourcePurchaseOrderId: po.id, currencyId: po.currencyId, priceIncludesTax: po.priceIncludesTax,
        linesDirty: false, updatedBy: userId, version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    const updatedContract = await this.prisma.counterpartyContract.findUnique({ where: { id: contractId } });
    for (const [index, { poLine, quantity }] of resolvedLines.entries()) {
      const line = await this.prisma.counterpartyContractLine.create({
        data: {
          tenantId, contractId, position: index,
          productId: poLine.productId, description: poLine.description, quantity,
          unitId: poLine.unitId, unitPrice: poLine.price ?? 0, discountPercent: 0,
          sourceOrderLineId: poLine.id,
          sourcePoTaxRatePercent: poLine.taxRate, sourcePoTaxAmount: poLine.taxAmount,
        },
      });
      await this.recalculateLine(tenantId, organizationId, po.counterpartyId, line.id, updatedContract!, userId);
    }
    await this.recalculateContractTotals(tenantId, contractId);

    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_SOURCE_PURCHASE_ORDER_CHANGED', entityType: 'CounterpartyContract',
      entityId: contractId, action: 'UPDATE', userId,
      oldValues: { sourcePurchaseOrderId: contract.sourcePurchaseOrderId },
      newValues: { sourcePurchaseOrderId: po.id, lineCount: resolvedLines.length },
    });
    return this.get(tenantId, membershipId, organizationId, contractId);
  }

  // -- Approval (spec sections 8, 14) ------------------------------------------

  /** Approval gate. Extends the original section-8/section-5 field list
   * with section 14's additions: a linked purchase order, at least one
   * complete nomenclature line, the counterparty's own tax status
   * resolved (its own approval already required this), tax calculation
   * completed on every line, and at least one document uploaded. */
  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.get(tenantId, membershipId, organizationId, id);
    if (contract.status === 'APPROVED' || contract.status === 'ACTIVE') throw new ValidationAppError(`Contract is already ${contract.status}`);
    if (contract.status === 'CANCELLED') throw new ValidationAppError('Cannot approve a cancelled contract');

    const documentCount = await this.prisma.counterpartyDocument.count({ where: { tenantId, ownerType: 'CONTRACT', ownerId: id, active: true } });
    const counterparty = await this.prisma.counterparty.findFirst({ where: { id: contract.counterpartyId } });

    const missing = await this.missingRequiredFields(contract, documentCount, counterparty);
    if (missing.length > 0) {
      const fieldErrors: Record<string, string[]> = {};
      for (const f of missing) fieldErrors[f] = ['Required for approval'];
      throw new ValidationAppError(`Cannot approve — missing required fields: ${missing.join(', ')}`, fieldErrors);
    }

    const result = await this.prisma.counterpartyContract.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'COUNTERPARTY_CONTRACT_APPROVED', entityType: 'CounterpartyContract', entityId: id, action: 'APPROVE', userId });
    return this.prisma.counterpartyContract.findUnique({ where: { id } });
  }

  async setStatus(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, status: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!STATUSES.includes(status)) throw new ValidationAppError(`Unknown status: ${status}`);
    const contract = await this.get(tenantId, membershipId, organizationId, id);
    if (status !== 'CANCELLED' && (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL')) {
      throw new ValidationAppError('Approve the contract before changing its status further');
    }
    const result = await this.prisma.counterpartyContract.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { status, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'COUNTERPARTY_CONTRACT_STATUS_CHANGED', entityType: 'CounterpartyContract', entityId: id, action: 'UPDATE', userId, newValues: { status } });
    return this.prisma.counterpartyContract.findUnique({ where: { id } });
  }

  // -- helpers ----------------------------------------------------------------

  private async requireEditable(tenantId: string, membershipId: string, organizationId: string, id: string) {
    const contract = await this.get(tenantId, membershipId, organizationId, id);
    if (contract.status === 'APPROVED' || contract.status === 'ACTIVE') throw new ValidationAppError('Unapprove the contract before editing its lines');
    if (contract.status === 'CANCELLED') throw new ValidationAppError('Cannot edit a cancelled contract');
    return contract;
  }

  private async assertCurrency(currencyId: string) {
    const cur = await this.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!cur) throw new ValidationAppError('Currency not found');
  }

  private async assertResponsiblePerson(tenantId: string, id: string) {
    const person = await this.prisma.responsiblePerson.findFirst({ where: { id, tenantId } });
    if (!person) throw new ValidationAppError('Responsible person not found');
  }

  private async missingRequiredFields(contract: any, documentCount: number, counterparty: { id: string; status: string; vatPayer: boolean } | null): Promise<string[]> {
    const missing: string[] = [];
    if (!contract.number?.trim()) missing.push('number');
    if (!contract.subject?.trim()) missing.push('subject');
    if (!contract.contractType?.trim()) missing.push('contractType');
    if (!contract.signedDate) missing.push('signedDate');
    if (!contract.startDate) missing.push('startDate');
    if (!contract.endDate) missing.push('endDate');
    if (contract.amount == null) missing.push('amount');
    if (!contract.currencyId) missing.push('currencyId');
    if (!contract.paymentTerms?.trim()) missing.push('paymentTerms');
    if (!contract.responsiblePersonId) missing.push('responsiblePersonId');

    // spec section 14 additions
    if (!contract.sourcePurchaseOrderId) missing.push('sourcePurchaseOrderId');
    if (documentCount === 0) missing.push('documents');
    if (!contract.deliveryTerms?.trim()) missing.push('deliveryTerms');
    if (!contract.lines || contract.lines.length === 0) {
      missing.push('lines');
    } else {
      let anyLineIncomplete = false;
      let anyTaxIncomplete = false;
      for (const line of contract.lines) {
        if (!line.productId || !(Number(line.quantity) > 0) || !line.unitId || line.unitPrice == null) anyLineIncomplete = true;
        if (line.taxCalculationError || line.taxAmount == null) anyTaxIncomplete = true;
      }
      if (anyLineIncomplete) missing.push('lineDetails');
      if (anyTaxIncomplete) missing.push('taxCalculation');

      const lineTotalSum = round2(contract.lines.reduce((s: Decimal, l: any) => s.plus(l.lineTotal != null ? l.lineTotal.toString() : 0), new Decimal(0)));
      if (contract.amount != null && !round2(new Decimal(contract.amount.toString())).equals(lineTotalSum)) {
        missing.push('amountMismatch');
      }
    }

    if (!counterparty) {
      missing.push('counterpartyTaxStatus');
    } else if (counterparty.status !== 'APPROVED' && counterparty.status !== 'ACTIVE') {
      // "Kontragentin vergi statusu müəyyən edilməlidir" — the
      // counterparty's OWN approval already required residency + VÖEN-or-
      // foreign-tax-id, so an unapproved counterparty's tax status counts
      // as undetermined here.
      missing.push('counterpartyTaxStatus');
    }

    return missing;
  }
}
