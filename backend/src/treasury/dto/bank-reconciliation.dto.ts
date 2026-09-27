import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateBankStatementLineDto {
  @IsString()
  bankAccountId!: string;

  @IsDateString()
  statementDate!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  /** Positive = inflow (credit to the account), negative = outflow. */
  @IsNumber()
  amount!: number;
}

export class UpdateBankStatementLineDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsDateString()
  statementDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class MatchBankStatementLineDto {
  @IsIn([
    'PAYMENT_ORDER',
    'INCOMING_BANK_PAYMENT',
    'INTERNAL_BANK_TRANSFER',
    'BANK_FEE',
    'FX_CONVERSION',
  ])
  documentType!:
    | 'PAYMENT_ORDER'
    | 'INCOMING_BANK_PAYMENT'
    | 'INTERNAL_BANK_TRANSFER'
    | 'BANK_FEE'
    | 'FX_CONVERSION';

  @IsString()
  documentId!: string;
}

export class ClassifyAsBankFeeDto {
  @IsOptional()
  @IsIn(['MONTHLY_MAINTENANCE', 'TRANSFER_FEE', 'COMMISSION', 'OTHER'])
  feeType?: string;
}

export class CreateBankReconciliationDto {
  @IsString()
  bankAccountId!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsNumber()
  bookOpeningBalance!: number;

  @IsNumber()
  bankOpeningBalance!: number;
}

export class CloseBankReconciliationDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ReopenBankReconciliationDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  reason!: string;
}
