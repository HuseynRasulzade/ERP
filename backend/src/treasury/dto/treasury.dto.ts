import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
