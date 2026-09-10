import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

/**
 * CostingService interface (spec sections 36-38, 115). Phase 11 (Costing
 * Engine — FIFO/weighted-average) does not exist in this codebase.
 * `getUnitCost` therefore always returns `null` ("cost unavailable") —
 * per spec section 38, this is a DELIBERATE, disclosed limitation, never
 * papered over by using the selling price as a fake cost. Every caller
 * (`SalesInvoicePostingHandler`) treats `null` as "skip the COGS posting
 * entirely for this line" rather than posting a wrong or zero amount.
 * Swapping in a real Phase 11 implementation later requires no interface
 * change on the Sales side.
 */
@Injectable()
export class CostingService {
  async getUnitCost(
    _tenantId: string,
    _organizationId: string,
    _productId: string,
    _warehouseId: string,
    _businessDate: Date,
  ): Promise<Decimal | null> {
    return null;
  }
}
