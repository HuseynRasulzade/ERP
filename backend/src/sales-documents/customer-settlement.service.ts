import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface SettlementObligationView {
  id: string;
  counterpartyId: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  currencyId: string | null;
  amountDue: string;
  paidAmount: string;
  remainingAmount: string;
  dueDate: string | null;
  status: string; // NOT_PAID|OVERDUE|PAID — OVERDUE computed live, never stored
}

/**
 * CustomerSettlementService — the AR mirror of SupplierSettlementService.
 * Reads `SettlementObligation` (the AR contract `SalesInvoicePostingHandler`
 * creates) and reflects `paidAmount`/`status` exactly as
 * `CashTransactionPostingHandler`'s CUSTOMER_PAYMENT clearing path leaves
 * them — never fabricated, `OVERDUE` computed live from `dueDate`.
 */
@Injectable()
export class CustomerSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string): Promise<SettlementObligationView[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.settlementObligation.findMany({ where: { organizationId, ...(counterpartyId ? { counterpartyId } : {}) }, orderBy: { createdAt: 'desc' } });
    return rows.map(toView);
  }

  async forInvoice(tenantId: string, membershipId: string, organizationId: string, salesInvoiceId: string): Promise<SettlementObligationView | null> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementObligation.findFirst({ where: { organizationId, sourceDocumentType: 'SALES_INVOICE', sourceDocumentId: salesInvoiceId } });
    return row ? toView(row) : null;
  }

  /** Total outstanding receivable for a customer — a live sum, never a
   * stored running balance, mirroring SupplierSettlementService.outstandingForSupplier. */
  async outstandingForCustomer(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string): Promise<string> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.settlementObligation.findMany({ where: { organizationId, counterpartyId, status: { not: 'CANCELLED' } } });
    return rows.reduce((sum, r) => sum.plus(new Decimal(r.amountDue.toString()).minus(r.paidAmount.toString())), new Decimal(0)).toFixed(2);
  }
}

function toView(row: { id: string; counterpartyId: string; sourceDocumentType: string; sourceDocumentId: string; currencyId: string | null; amountDue: any; paidAmount: any; dueDate: Date | null; status: string }): SettlementObligationView {
  const remaining = new Decimal(row.amountDue.toString()).minus(row.paidAmount.toString());
  const isOverdue = row.status === 'NOT_PAID' && row.dueDate !== null && row.dueDate < new Date() && remaining.gt(0);
  return {
    id: row.id,
    counterpartyId: row.counterpartyId,
    sourceDocumentType: row.sourceDocumentType,
    sourceDocumentId: row.sourceDocumentId,
    currencyId: row.currencyId,
    amountDue: row.amountDue.toString(),
    paidAmount: row.paidAmount.toString(),
    remainingAmount: remaining.toFixed(2),
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    status: isOverdue ? 'OVERDUE' : row.status,
  };
}
