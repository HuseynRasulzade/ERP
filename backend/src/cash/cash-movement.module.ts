import { Module } from '@nestjs/common';
import { CashMovementService } from './cash-movement.service';

/**
 * Standalone module for `CashMovementService` — see
 * `treasury/bank-cash-movement.module.ts`'s own docstring for why this
 * needs to be its own tiny module (PrismaService only): `SettlementModule`
 * writes through it for a cash-desk payment leg without importing the
 * whole `CashModule`, and `CashModule` itself needs `SettlementModule` for
 * `OpenItemService`/`PaymentAllocationService` — importing `CashModule`
 * from `SettlementModule` would be backwards and risks a cycle.
 */
@Module({
  providers: [CashMovementService],
  exports: [CashMovementService],
})
export class CashMovementModule {}
