import { Module } from '@nestjs/common';
import { AccountablePersonService } from './accountable-person.service';

/** Standalone module — see `cash-movement.module.ts`'s own docstring for
 * why (SettlementModule's posting handler needs this without importing
 * the whole CashModule). */
@Module({
  providers: [AccountablePersonService],
  exports: [AccountablePersonService],
})
export class AccountablePersonModule {}
