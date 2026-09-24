import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { InventoryCostMovement } from '@prisma/client';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { d, money, splitAmount } from './costing.types';

export interface ComponentInput {
  componentType: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  amount: Decimal;
  allocatedAmount: Decimal;
}

export interface SourcedValue {
  value: Decimal;
  status: 'FINAL' | 'PROVISIONAL' | 'ERROR';
  components: ComponentInput[];
  errors: { errorCode: string; description: string; severity: string; blocking: boolean }[];
}

/** Documents whose posting status is flipping inside the current
 * transaction: posting handlers run BEFORE the framework marks the
 * document POSTED (and undo runs before it is marked NOT_POSTED). */
export interface SourceVisibility {
  includeDocumentIds: Set<string>;
  excludeDocumentIds: Set<string>;
}

export interface RelatedCost {
  id: string;
  quantity: Decimal; // signed
  totalCost: Decimal; // signed
  costStatus: string;
}

/**
 * GRNI clearing amount for `invoiceQuantity` of a receipt line — the SAME
 * formula PurchaseInvoicePostingHandler uses to clear the receipt's GRNI
 * liability, so the invoice's price difference booked to inventory and
 * the costing engine's INVOICE_PRICE_DIFFERENCE component can never drift
 * apart (spec section 18).
 */
export function grniClearingAmount(receiptLine: { lineTotal: { toString(): string }; quantity: { toString(): string } }, invoiceQuantity: Decimal.Value): Decimal {
  const qty = d(receiptLine.quantity);
  if (qty.isZero()) return new Decimal(0);
  return money(d(receiptLine.lineTotal).mul(invoiceQuantity).div(qty));
}

const APC_COMPONENT_TYPE: Record<string, string> = {
  TRANSPORT: 'TRANSPORT',
  FREIGHT: 'FREIGHT',
  CUSTOMS: 'CUSTOMS',
  INSURANCE: 'INSURANCE',
  LOADING: 'LOADING',
  BROKER: 'BROKER',
  HANDLING: 'HANDLING',
  CERTIFICATION: 'CERTIFICATION',
};

/**
 * Cost inputs (spec sections 16-23, 26-28, 30): turns source documents
 * into incoming values and exposes the related cost rows the engine needs
 * for derived/specific costs. Read-only — never writes.
 *  - Goods Receipt: receipt price (provisional) + posted Purchase Invoice
 *    price difference + posted Additional Purchase Cost allocations +
 *    posted manual cost adjustments; FINAL once fully invoiced.
 *  - Inventory Adjustment (surplus / opening balance): `costReference`
 *    as the line value (never an arbitrary user cost for write-offs).
 * Values are split across a line's movements (one per serial unit) by
 * largest remainder so the line total is exact.
 */
@Injectable()
export class CostSourceService {
  async sourcedValue(tx: PrismaTransactionClient, cm: InventoryCostMovement, visibility: SourceVisibility): Promise<SourcedValue | null> {
    if (cm.sourceDocumentType === 'GOODS_RECEIPT' && cm.sourceDocumentLineId) return this.goodsReceiptValue(tx, cm, visibility);
    if (cm.sourceDocumentType === 'INVENTORY_ADJUSTMENT' && cm.sourceDocumentLineId) return this.adjustmentValue(tx, cm);
    return null;
  }

  private async lineMovementWeights(tx: PrismaTransactionClient, cm: InventoryCostMovement): Promise<{ index: number; weights: Decimal[] }> {
    const siblings = await tx.inventoryCostMovement.findMany({
      where: { tenantId: cm.tenantId, sourceDocumentType: cm.sourceDocumentType, sourceDocumentId: cm.sourceDocumentId, sourceDocumentLineId: cm.sourceDocumentLineId },
      orderBy: { movementSequence: 'asc' },
      select: { id: true, quantity: true },
    });
    const index = siblings.findIndex((s) => s.id === cm.id);
    return { index: index < 0 ? 0 : index, weights: siblings.length > 0 ? siblings.map((s) => d(s.quantity).abs()) : [d(cm.quantity).abs()] };
  }

  private async goodsReceiptValue(tx: PrismaTransactionClient, cm: InventoryCostMovement, visibility: SourceVisibility): Promise<SourcedValue> {
    const line = await tx.goodsReceiptLine.findFirst({ where: { id: cm.sourceDocumentLineId!, tenantId: cm.tenantId } });
    const errors: SourcedValue['errors'] = [];
    if (!line) {
      return { value: new Decimal(0), status: 'ERROR', components: [], errors: [{ errorCode: 'BROKEN_SOURCE_DOCUMENT_LINK', description: `Goods receipt line ${cm.sourceDocumentLineId} not found`, severity: 'BLOCKING', blocking: true }] };
    }
    const { index, weights } = await this.lineMovementWeights(tx, cm);
    const share = (amount: Decimal) => splitAmount(amount, weights)[index];

    const lineComponents: ComponentInput[] = [];
    lineComponents.push({ componentType: 'BASE_PRICE', sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentId: line.goodsReceiptId, sourceDocumentLineId: line.id, amount: d(line.lineTotal), allocatedAmount: new Decimal(0) });

    const invoiceLines = await tx.purchaseInvoiceLine.findMany({
      where: { tenantId: cm.tenantId, goodsReceiptLineId: line.id, OR: [{ purchaseInvoice: { postingStatus: 'POSTED' } }, { purchaseInvoiceId: { in: [...visibility.includeDocumentIds] } }], purchaseInvoiceId: { notIn: [...visibility.excludeDocumentIds] } },
      orderBy: { createdAt: 'asc' },
    });
    let invoicedQty = new Decimal(0);
    for (const inv of invoiceLines) {
      invoicedQty = invoicedQty.plus(d(inv.quantity));
      const diff = d(inv.lineTotal).minus(grniClearingAmount(line, d(inv.quantity)));
      if (!diff.isZero()) {
        lineComponents.push({ componentType: 'INVOICE_PRICE_DIFFERENCE', sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: inv.purchaseInvoiceId, sourceDocumentLineId: inv.id, amount: diff, allocatedAmount: new Decimal(0) });
      }
    }

    const allocations = await tx.purchaseCostAllocation.findMany({
      where: { tenantId: cm.tenantId, goodsReceiptLineId: line.id, OR: [{ additionalPurchaseCost: { postingStatus: 'POSTED' } }, { additionalPurchaseCostId: { in: [...visibility.includeDocumentIds] } }], additionalPurchaseCostId: { notIn: [...visibility.excludeDocumentIds] } },
      include: { additionalPurchaseCost: { select: { costType: true } } },
      orderBy: { createdAt: 'asc' },
    });
    for (const a of allocations) {
      lineComponents.push({
        componentType: APC_COMPONENT_TYPE[a.additionalPurchaseCost.costType] ?? 'OTHER_CAPITALIZABLE',
        sourceDocumentType: 'ADDITIONAL_PURCHASE_COST',
        sourceDocumentId: a.additionalPurchaseCostId,
        amount: d(a.allocatedAmount),
        allocatedAmount: new Decimal(0),
      });
    }

    const components = lineComponents.map((c) => ({ ...c, allocatedAmount: share(c.amount) }));
    components.push(...(await this.manualComponents(tx, cm)));

    const value = components.reduce((s, c) => s.plus(c.allocatedAmount), new Decimal(0));
    const fullyInvoiced = invoicedQty.gte(d(line.quantity));
    if (value.isZero()) {
      errors.push({ errorCode: fullyInvoiced ? 'ZERO_COST_STOCK' : 'MISSING_SOURCE_PRICE', description: `Goods receipt line ${line.id} has zero value${fullyInvoiced ? ' (invoiced at zero — free goods)' : ' — awaiting a priced invoice'}`, severity: 'WARNING', blocking: false });
    }
    return { value, status: fullyInvoiced ? 'FINAL' : 'PROVISIONAL', components, errors };
  }

  private async adjustmentValue(tx: PrismaTransactionClient, cm: InventoryCostMovement): Promise<SourcedValue | null> {
    const line = await tx.inventoryAdjustmentLine.findFirst({ where: { id: cm.sourceDocumentLineId!, tenantId: cm.tenantId } });
    if (!line || line.costReference == null) {
      if (cm.movementType === 'OPENING_BALANCE') {
        return {
          value: new Decimal(0),
          status: 'ERROR',
          components: [],
          errors: [{ errorCode: 'MISSING_SOURCE_PRICE', description: `Opening balance line ${cm.sourceDocumentLineId} has no costReference — opening cost unknown`, severity: 'BLOCKING', blocking: true }],
        };
      }
      return null; // surplus without a reference: valued at current cost by the engine
    }
    const { index, weights } = await this.lineMovementWeights(tx, cm);
    const allocated = splitAmount(d(line.costReference), weights)[index];
    const components: ComponentInput[] = [
      { componentType: cm.movementType === 'OPENING_BALANCE' ? 'OPENING_BALANCE' : 'SURPLUS_VALUE', sourceDocumentType: 'INVENTORY_ADJUSTMENT', sourceDocumentId: line.inventoryAdjustmentId, sourceDocumentLineId: line.id, amount: d(line.costReference), allocatedAmount: allocated },
      ...(await this.manualComponents(tx, cm)),
    ];
    return { value: components.reduce((s, c) => s.plus(c.allocatedAmount), new Decimal(0)), status: 'FINAL', components, errors: [] };
  }

  /** Posted manual cost adjustments that target this incoming movement
   * (spec sections 44-45) — capitalized onto the layer, the engine then
   * distributes the already-consumed share to prior exits. */
  private async manualComponents(tx: PrismaTransactionClient, cm: InventoryCostMovement): Promise<ComponentInput[]> {
    const lines = await tx.inventoryCostAdjustmentLine.findMany({
      where: { tenantId: cm.tenantId, costMovementId: cm.id, impactType: 'INVENTORY', adjustment: { status: 'POSTED', isSystemGenerated: false } },
      include: { adjustment: true },
      orderBy: { createdAt: 'asc' },
    });
    return lines.map((l) => ({
      componentType: 'MANUAL_ADJUSTMENT',
      sourceDocumentType: 'INVENTORY_COST_ADJUSTMENT',
      sourceDocumentId: l.adjustmentId,
      sourceDocumentLineId: l.id,
      amount: d(l.adjustmentAmount),
      allocatedAmount: d(l.adjustmentAmount),
    }));
  }

  /** Shipment cost rows a Sales Return line restores (spec 26, 124). */
  async salesReturnSource(tx: PrismaTransactionClient, cm: InventoryCostMovement): Promise<RelatedCost[] | null> {
    if (!cm.sourceDocumentLineId) return null;
    const returnLine = await tx.salesReturnLine.findFirst({ where: { id: cm.sourceDocumentLineId, tenantId: cm.tenantId } });
    if (!returnLine?.sourceInvoiceLineId) return null;
    const invoiceLine = await tx.salesInvoiceLine.findFirst({ where: { id: returnLine.sourceInvoiceLineId, tenantId: cm.tenantId } });
    const shipmentLineId = (invoiceLine as any)?.sourceShipmentLineId as string | undefined;
    if (!shipmentLineId) return null;
    const rows = await tx.inventoryCostMovement.findMany({
      where: { tenantId: cm.tenantId, sourceDocumentType: 'SHIPMENT', sourceDocumentLineId: shipmentLineId },
      select: { id: true, quantity: true, totalCost: true, costStatus: true },
    });
    if (rows.length === 0) return null;
    return rows.map((r) => ({ id: r.id, quantity: d(r.quantity), totalCost: d(r.totalCost), costStatus: r.costStatus }));
  }

  /** The TRANSFER_OUT cost rows a cross-key TRANSFER_IN carries (spec 30-31). */
  async transferOutSource(tx: PrismaTransactionClient, cm: InventoryCostMovement): Promise<(RelatedCost & { costingKey: string; effectiveDate: Date })[]> {
    const rows = await tx.inventoryCostMovement.findMany({
      where: { tenantId: cm.tenantId, sourceDocumentType: cm.sourceDocumentType, sourceDocumentId: cm.sourceDocumentId, sourceDocumentLineId: cm.sourceDocumentLineId, movementType: 'TRANSFER_OUT' },
      select: { id: true, quantity: true, totalCost: true, costStatus: true, costingKey: true, effectiveDate: true },
    });
    return rows.map((r) => ({ id: r.id, quantity: d(r.quantity), totalCost: d(r.totalCost), costStatus: r.costStatus, costingKey: r.costingKey, effectiveDate: r.effectiveDate }));
  }

  /** Receipt line ids a Purchase Return line comes from (spec 28, 125). */
  async purchaseReturnReceiptLines(tx: PrismaTransactionClient, cm: InventoryCostMovement): Promise<string[]> {
    if (!cm.sourceDocumentLineId) return [];
    const line = await tx.purchaseReturnLine.findFirst({ where: { id: cm.sourceDocumentLineId, tenantId: cm.tenantId } });
    if (!line) return [];
    if (line.sourceReceiptLineId) return [line.sourceReceiptLineId];
    if (line.sourceInvoiceLineId) {
      const inv = await tx.purchaseInvoiceLine.findFirst({ where: { id: line.sourceInvoiceLineId, tenantId: cm.tenantId } });
      if (inv?.goodsReceiptLineId) return [inv.goodsReceiptLineId];
    }
    return [];
  }

  async receiptLineCostRows(tx: PrismaTransactionClient, tenantId: string, receiptLineIds: string[]): Promise<RelatedCost[]> {
    if (receiptLineIds.length === 0) return [];
    const rows = await tx.inventoryCostMovement.findMany({
      where: { tenantId, sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentLineId: { in: receiptLineIds } },
      select: { id: true, quantity: true, totalCost: true, costStatus: true },
    });
    return rows.map((r) => ({ id: r.id, quantity: d(r.quantity), totalCost: d(r.totalCost), costStatus: r.costStatus }));
  }
}
