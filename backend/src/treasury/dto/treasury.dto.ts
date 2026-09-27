import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
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

  @IsOptional()
  @IsIn(['CRITICAL', 'HIGH', 'NORMAL', 'LOW'])
  priority?: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

  @IsOptional()
  @IsIn([
    'SUPPLIER',
    'PAYROLL',
    'TAX',
    'RENT',
    'LOAN',
    'CAPEX',
    'OPEX',
    'DIVIDEND',
    'INTERNAL_TRANSFER',
    'OTHER',
  ])
  category?: string;

  @IsOptional()
  @IsDateString()
  requestedPaymentDate?: string;
}

export class ApprovePaymentRequestDto {
  @IsOptional()
  @IsNumber()
  approvedAmount?: number; // defaults to the full requested amount

  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectPaymentRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
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

const CASH_TRANSACTION_CATEGORIES = [
  'CUSTOMER_PAYMENT',
  'SUPPLIER_PAYMENT',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
  // docx spec Phase 15, sections 10-11 — full receipt/expense operation
  // type catalog (spec sections 10-11), same category field either
  // direction reuses.
  'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE',
  'EMPLOYEE_ADVANCE',
  'EMPLOYEE_ADVANCE_RETURN',
  'SALARY_PAYMENT',
  'PETTY_CASH_EXPENSE',
  'CASH_SHORTAGE',
  'CASH_SURPLUS',
  'LOAN_RECEIPT',
  'LOAN_REPAYMENT',
  'OWNER_CONTRIBUTION',
  'REFUND_TO_CUSTOMER',
  'BANK_WITHDRAWAL',
  'CASH_TO_BANK',
] as const;

export class CreateCashTransactionDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  cashboxId!: string;

  @IsIn(['RECEIPT', 'PAYMENT'])
  direction!: 'RECEIPT' | 'PAYMENT';

  @IsIn(CASH_TRANSACTION_CATEGORIES)
  category!: (typeof CASH_TRANSACTION_CATEGORIES)[number];

  /** Required for CUSTOMER_PAYMENT/SUPPLIER_PAYMENT/*_ADVANCE, ignored
   * otherwise. */
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

  /** The cashier this document is recorded against — when set, validated
   * against CashierAssignment at posting (docx spec Phase 15 section 7).
   * Omit to skip that check entirely. */
  @IsOptional()
  @IsString()
  cashierId?: string;

  /** Required for EMPLOYEE_ADVANCE/EMPLOYEE_ADVANCE_RETURN — the
   * accountable ResponsiblePerson (spec sections 27-32). */
  @IsOptional()
  @IsString()
  employeeId?: string;

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
  @IsIn(CASH_TRANSACTION_CATEGORIES)
  category?: (typeof CASH_TRANSACTION_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  cashierId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;
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

const INCOMING_CATEGORIES = [
  'CUSTOMER_PAYMENT',
  'CUSTOMER_ADVANCE',
  'LOAN_RECEIPT',
  'REFUND_FROM_SUPPLIER',
  'INTEREST_INCOME',
  'OTHER',
] as const;

export class CreateIncomingBankPaymentDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  bankAccountId!: string;

  @IsOptional()
  @IsIn(INCOMING_CATEGORIES)
  category?: (typeof INCOMING_CATEGORIES)[number];

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

  /** CUSTOMER_PAYMENT/CUSTOMER_ADVANCE only: the Sales Invoice this receipt
   * clears — left unset, it settles as a customer advance instead. */
  @IsOptional()
  @IsString()
  sourceSalesInvoiceId?: string;
}

export class UpdateIncomingBankPaymentDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsIn(INCOMING_CATEGORIES)
  category?: (typeof INCOMING_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  counterpartyId?: string;

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

export class CreateInternalBankTransferDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  sourceBankAccountId!: string;

  @IsString()
  destinationBankAccountId!: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsNumber()
  feeAmount?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

const BANK_FEE_TYPES = [
  'MONTHLY_MAINTENANCE',
  'TRANSFER_FEE',
  'COMMISSION',
  'OTHER',
] as const;

export class CreateBankFeeDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  bankAccountId!: string;

  @IsOptional()
  @IsIn(BANK_FEE_TYPES)
  feeType?: (typeof BANK_FEE_TYPES)[number];

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

const APPROVAL_STEP_TYPES = [
  'PROCUREMENT_OFFICER',
  'DEPARTMENT_HEAD',
  'DIRECTOR',
  'FINANCE',
  'ACCOUNTING',
  'WAREHOUSE_SUPERVISOR',
  'SALES_MANAGER',
] as const;

export class CreateTreasuryApprovalRuleDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  minAmount!: number;

  @IsOptional()
  @IsNumber()
  maxAmount?: number;

  @IsIn(APPROVAL_STEP_TYPES)
  stepType!: (typeof APPROVAL_STEP_TYPES)[number];

  @IsInt()
  @Min(1)
  sequence!: number;
}

export class CreateTreasuryLiquidityPolicyDto {
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsNumber()
  minimumBalance!: number;
}

export class CreateFXConversionDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  sourceBankAccountId!: string;

  @IsString()
  destinationBankAccountId!: string;

  @IsString()
  sourceCurrencyId!: string;

  @IsNumber()
  sourceAmount!: number;

  @IsString()
  destinationCurrencyId!: string;

  @IsNumber()
  destinationAmount!: number;

  @IsOptional()
  @IsNumber()
  officialRate?: number;

  @IsOptional()
  @IsNumber()
  bankFee?: number;

  @IsOptional()
  @IsString()
  description?: string;
}
