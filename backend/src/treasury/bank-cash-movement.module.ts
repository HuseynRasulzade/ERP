import { Module } from '@nestjs/common';
import { BankCashMovementService } from './bank-cash-movement.service';

/**
 * Standalone module for `BankCashMovementService` — the Layer 2 register
 * (spec section 30) both `SettlementModule` (a `SettlementPayment`'s bank
 * leg) and the rest of `TreasuryModule` (InternalTransfer/BankFee/
 * FXConversion) need to write through. Kept as its own tiny module
 * (PrismaService only) so neither of those two modules has to import the
 * OTHER one just to reach this one service — `SettlementModule` importing
 * the full `TreasuryModule` would be backwards (Phase 14 depends on Phase
 * 13, never the reverse) and `TreasuryModule` already needs
 * `SettlementModule` for `OpenItemService`/`PaymentAllocationService`.
 */
@Module({
  providers: [BankCashMovementService],
  exports: [BankCashMovementService],
})
export class BankCashMovementModule {}
