import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
  @IsIn(['PAYMENT_ORDER'])
  documentType!: 'PAYMENT_ORDER';

  @IsString()
  documentId!: string;
}
