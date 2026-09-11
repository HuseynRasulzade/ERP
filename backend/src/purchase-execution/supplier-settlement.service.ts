import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface SupplierPayableView {
  id: string;
  counterpartyId: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  currencyId: string | null;
  invoiceAmount: string;
  paidAmount: string;
  remainingAmount: string;
  dueDate: string | null;
  status: string; // OPEN|OVERDUE|PAID|CANCELLED — OVERDUE computed live, never stored
}

/**
 * SupplierSettlementService (spec sections 10, 17). Reads `SupplierPayable`
 * — the AP contract `PurchaseInvoicePostingHandler` creates. `status`
 * stays `OPEN` in the stored row forever in this build (no Payment/
 * Advance engine, Phase 13/14 boundary — spec section 56); OVERDUE is
 * computed HERE, live, from `dueDate` vs "now" — never persisted, so it
 * can never go stale. `paidAmount` is always 0 and `remainingAmount`
 * always equals `invoiceAmount` — an honest reflection of "no payment
 * posting exists yet", not a fabricated PARTIALLY_PAID/PAID value.
 */
@Injectable()
export class SupplierSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string): Promise<SupplierPayableView[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.supplierPayable.findMany({ where: { organizationId, ...(counterpartyId ? { counterpartyId } : {}) }, orderBy: { createdAt: 'desc' } });
    return rows.map(toView);
  }

  async forInvoice(tenantId: string, membershipId: string, organizationId: string, purchaseInvoiceId: string): Promise<SupplierPayableView | null> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.supplierPayable.findFirst({ where: { organizationId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: purchaseInvoiceId } });
    return row ? toView(row) : null;
  }

  /** Total outstanding payable for a supplier — a live sum, never a
   * stored running balance (spec section 40's "outstanding supplier
   * invoices" dashboard metric reads from here). */
  async outstandingForSupplier(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string): Promise<string> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.supplierPayable.findMany({ where: { organizationId, counterpartyId, status: { not: 'CANCELLED' } } });
    return rows.reduce((sum, r) => sum.plus(new Decimal(r.invoiceAmount.toString()).minus(r.paidAmount.toString())), new Decimal(0)).toFixed(2);
  }
}

function toView(row: { id: string; counterpartyId: string; sourceDocumentType: string; sourceDocumentId: string; currencyId: string | null; invoiceAmount: any; paidAmount: any; dueDate: Date | null; status: string }): SupplierPayableView {
  const remaining = new Decimal(row.invoiceAmount.toString()).minus(row.paidAmount.toString());
  const isOverdue = row.status === 'OPEN' && row.dueDate !== null && row.dueDate < new Date() && remaining.gt(0);
  return {
    id: row.id,
    counterpartyId: row.counterpartyId,
    sourceDocumentType: row.sourceDocumentType,
    sourceDocumentId: row.sourceDocumentId,
    currencyId: row.currencyId,
    invoiceAmount: row.invoiceAmount.toString(),
    paidAmount: row.paidAmount.toString(),
    remainingAmount: remaining.toFixed(2),
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    status: isOverdue ? 'OVERDUE' : row.status,
  };
}
