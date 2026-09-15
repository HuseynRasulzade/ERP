import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SENSITIVE_MEASURES = new Set(['LABOR_COST']);

/**
 * ManagementDrillthroughService (docx spec Phase 24, sections 91,
 * 113-115, 141-142). Explains a measure by naming its numerator/
 * denominator, filters, period, and cost-status, then follows the
 * SAME source-document chain every operational module already exposes
 * (Sales invoice line -> COGS layer, AR balance -> open items, ...) —
 * never a duplicated drill-through index. Sensitive measures (payroll)
 * report only that a sensitive-permission gate applies; the CONTROLLER
 * decides whether to actually reveal employee-level rows based on
 * `MGMT_SENSITIVE_DRILLDOWN` (this service itself returns no employee
 * identifiers for a sensitive measure).
 */
@Injectable()
export class ManagementDrillthroughService {
  constructor(private readonly prisma: PrismaService) {}

  isSensitive(measureCode: string): boolean {
    return SENSITIVE_MEASURES.has(measureCode);
  }

  explainMeasure(measureCode: string, mode: { type: string }, filters: Record<string, unknown>) {
    return {
      measureCode,
      mode,
      filters,
      sensitive: this.isSensitive(measureCode),
      note: this.isSensitive(measureCode) ? 'Aggregate-only — employee-level detail requires MGMT_SENSITIVE_DRILLDOWN (spec section 141).' : undefined,
    };
  }

  /** Revenue -> underlying Sales Invoice lines for a customer/product/
   * period window (spec section 113's own drill-down chain). */
  async revenueSourceLines(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date, filters: { customerId?: string; productId?: string } = {}) {
    return this.prisma.salesInvoiceLine.findMany({
      where: { tenantId, salesInvoice: { organizationId, documentDate: { gte: periodStart, lte: periodEnd }, postingStatus: 'POSTED', ...(filters.customerId ? { counterpartyId: filters.customerId } : {}) }, ...(filters.productId ? { productId: filters.productId } : {}) },
      include: { salesInvoice: { select: { number: true, documentDate: true, counterpartyId: true } } },
      take: 200,
    });
  }

  /** AR balance -> open items -> invoices (spec section 92, 184). */
  async arOpenItems(tenantId: string, organizationId: string, customerId?: string) {
    return this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] }, ...(customerId ? { counterpartyId: customerId } : {}) }, take: 200 });
  }

  /** Inventory value -> cost layers -> source movements (spec section
   * 94). */
  async inventoryCostLayers(tenantId: string, organizationId: string, productId?: string) {
    return this.prisma.inventoryCostLayer.findMany({ where: { tenantId, organizationId, status: { not: 'REVERSED' }, ...(productId ? { productId } : {}) }, take: 200 });
  }
}
