import { IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentRequestDto {
  @IsString()
  purchaseInvoiceId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsNumber()
  amount?: number; // defaults to the invoice's own remaining payable amount

  @IsOptional()
  @IsString()
  description?: string;
}

export class CancelPaymentRequestDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreatePaymentOrderDto {
  @IsString()
  paymentRequestId!: string;

  @IsDateString()
  documentDate!: string;

  @IsString()
  bankAccountId!: string;

  /** The counterparty's OWN receiving account — optional; omitting it
   * skips the bank-account-change approval gate entirely (see
   * PaymentOrderPostingHandler.validateForPosting). */
  @IsOptional()
  @IsString()
  counterpartyBankAccountId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number; // defaults to the payment request's own amount

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdatePaymentOrderDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  bankReference?: string;
}

export class CreateCashTransactionDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  cashboxId!: string;

  @IsIn(['RECEIPT', 'PAYMENT'])
  direction!: 'RECEIPT' | 'PAYMENT';

  @IsIn(['CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'OTHER_INCOME', 'OTHER_EXPENSE'])
  category!: 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT' | 'OTHER_INCOME' | 'OTHER_EXPENSE';

  /** Required for CUSTOMER_PAYMENT/SUPPLIER_PAYMENT, ignored otherwise. */
  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  description?: string;

  /** CUSTOMER_PAYMENT only: the Sales Invoice this receipt clears — when
   * given, reduces that invoice's SettlementObligation.paidAmount on post
   * instead of settling against the transaction itself. */
  @IsOptional()
  @IsString()
  sourceSalesInvoiceId?: string;

  /** SUPPLIER_PAYMENT only: the Purchase Invoice this payment clears —
   * same idea as sourceSalesInvoiceId, mirrored for the AP side. */
  @IsOptional()
  @IsString()
  sourcePurchaseInvoiceId?: string;
}

export class UpdateCashTransactionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsIn(['CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'OTHER_INCOME', 'OTHER_EXPENSE'])
  category?: 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT' | 'OTHER_INCOME' | 'OTHER_EXPENSE';

  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class SetPaymentAllocationLineDto {
  /** Omit to represent an unmatched advance (money held against the
   * counterparty, not yet applied to any specific invoice). */
  @IsOptional()
  @IsString()
  purchaseInvoiceId?: string;

  @IsNumber()
  amount!: number;
}

export class SetPaymentAllocationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetPaymentAllocationLineDto)
  allocations!: SetPaymentAllocationLineDto[];
}

export class ApplyAdvanceDto {
  @IsString()
  purchaseInvoiceId!: string;

  @IsNumber()
  amount!: number;
}

export class ReconcilePaymentOrderDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsNumber()
  bankStatementAmount!: number;

  @IsOptional()
  @IsString()
  bankReference?: string;
}
