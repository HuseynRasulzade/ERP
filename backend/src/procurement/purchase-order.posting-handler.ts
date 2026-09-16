import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { PurchaseOrderOnHoldError, SupplierNotEligibleError, ValidationAppError } from '../common/errors/app-error';
import { PURCHASE_ORDER_TYPE } from './purchase-order.repository';

const ELIGIBLE_SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];

/**
 * Posting handler for PurchaseOrder. `post` IS `ConfirmPurchaseOrder`
 * (spec section 26) — the generic document-framework post command is
 * reused rather than a parallel confirmation state machine, exactly as
 * SalesOrderPostingHandler does for CustomerOrder confirmation:
 * `postingStatus = POSTED` IS `CONFIRMED`.
 *
 * `buildAccountingBatch` is DELIBERATELY NOT IMPLEMENTED on this handler
 * (spec sections 94-97 — critical rule: "no GL posting, no AP liability,
 * no physical stock receipt, no Tax Register posting occurs" on
 * confirmation). `DocumentPostingService.post` only calls
 * `handler.buildAccountingBatch` when the handler defines it (see its own
 * `if (handler.buildAccountingBatch)` guard) — omitting the method
 * entirely is the structural guarantee that confirming a PurchaseOrder can
 * never produce a JournalEntry, AccountingMovement, or TaxMovement, not
 * just a runtime `return null`.
 */
@Injectable()
export class PurchaseOrderPostingHandler implements DocumentPostingHandler {
  readonly documentType = PURCHASE_ORDER_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const order = await tx.purchaseOrder.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!order) throw new ValidationAppError('Document disappeared during posting');
    if (order.approvalStatus !== 'APPROVED') {
      throw new ValidationAppError('Cannot confirm a purchase order until it is fully approved');
    }
    if (order.lines.length === 0) throw new ValidationAppError('Cannot confirm a purchase order with no lines');

    // Collect EVERY problem across every line (never fail-fast on the
    // first one) so the user sees the whole list of what to fix in one
    // pass — same "draft can be incomplete, approval/posting is the gate"
    // convention as CounterpartyContractService.approve.
    const missingPriceLines: string[] = [];
    for (const line of order.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot confirm a purchase order with non-positive quantity');
      if (line.price == null) {
        missingPriceLines.push(line.id);
        continue;
      }
      if (line.price.lt(0)) throw new ValidationAppError('Cannot confirm a purchase order with negative price');
      if (!line.isService && !line.warehouseId && !order.warehouseId) {
        throw new ValidationAppError('A goods line requires a destination warehouse (header or line)');
      }
    }
    if (missingPriceLines.length > 0) {
      throw new ValidationAppError(
        'Cannot confirm — enter a price for every line first',
        { price: missingPriceLines },
      );
    }

    // Supplier eligibility (spec section 107): must be an active SUPPLIER
    // or BOTH counterparty — a customer-only counterparty is rejected.
    const supplier = await tx.counterparty.findFirst({ where: { id: order.counterpartyId, tenantId } });
    if (!supplier || !supplier.active) {
      throw new SupplierNotEligibleError('missing or inactive counterparty');
    }
    if (!ELIGIBLE_SUPPLIER_TYPES.includes(supplier.counterpartyType)) {
      throw new SupplierNotEligibleError('counterparty does not have the SUPPLIER role');
    }

    const activeHolds = await tx.purchaseOrderHold.findMany({ where: { tenantId, purchaseOrderId: order.id, status: 'ACTIVE' } });
    if (activeHolds.length > 0) {
      throw new PurchaseOrderOnHoldError(activeHolds.map((h) => h.holdType));
    }
  }

  async buildMovements(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<RegisterMovementInput[]> {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!order) throw new ValidationAppError('Document disappeared during posting');

    return order.lines.map((line) => ({
      registerCode: 'PURCHASE_ORDER_REGISTER',
      recorderLineId: line.id,
      businessDate: document.postingDate ?? document.documentDate,
      movementType: 'PURCHASE_ORDER_LINE',
      dimensions: {
        organizationId: document.organizationId ?? null,
        counterpartyId: order.counterpartyId,
        productId: line.productId,
        unitId: line.unitId,
        warehouseId: line.warehouseId ?? order.warehouseId ?? null,
      },
      resources: {
        quantity: line.quantity.toString(),
        // validateForPosting already rejected any line with a null price
        // before buildMovements can run — the fallback never fires.
        price: line.price?.toString() ?? '0',
        lineTotal: line.lineTotal.toString(),
        taxAmount: line.taxAmount.toString(),
        lineTotalWithTax: line.lineTotalWithTax.toString(),
        currencyId: order.currencyId,
      },
    }));
  }
}
