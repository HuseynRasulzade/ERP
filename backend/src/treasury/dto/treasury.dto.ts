import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreatePaymentRequestDto {
  @IsISO8601() requestDate!: string;
  @IsOptional() @IsISO8601() requestedPaymentDate?: string;
  @IsOptional() @IsIn(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']) paymentPriority?: string;
  @IsOptional() @IsString() paymentCategory?: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() bankAccountId?: string;
  @IsString() currencyId!: string;
  @IsNumber() requestedAmount!: number;
  @IsOptional() @IsString() paymentPurpose?: string;
  @IsOptional() @IsString() sourceDocumentType?: string;
  @IsOptional() @IsString() sourceDocumentId?: string;
  @IsOptional() @IsString() sourceOpenItemId?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsString() comment?: string;
}

export class ApproveRequestDto {
  @IsNumber() approvedAmount!: number;
  @IsOptional() @IsString() comment?: string;
}

export class CreatePaymentInstructionDto {
  @IsString() paymentRequestId!: string;
  @IsString() bankAccountId!: string;
  @IsOptional() @IsString() beneficiaryName?: string;
  @IsOptional() @IsString() beneficiaryBankDetails?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsISO8601() executionDate?: string;
  @IsOptional() @IsString() purpose?: string;
}

export class CreateBankPaymentDto {
  @IsIn(['INCOMING', 'OUTGOING']) direction!: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsIn(['CUSTOMER', 'SUPPLIER']) counterpartyRole?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsString() bankAccountId!: string;
  @IsOptional() @IsString() operationType?: string;
  @IsOptional() @IsString() paymentRequestId?: string;
  @IsOptional() @IsString() paymentInstructionId?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsNumber() exchangeRate?: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() bankReference?: string;
  @IsOptional() @IsString() externalTransactionId?: string;
  @IsISO8601() documentDate!: string;
}

export class CreateInternalTransferDto {
  @IsString() sourceBankAccountId!: string;
  @IsString() destinationBankAccountId!: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsNumber() feeAmount?: number;
  @IsOptional() @IsIn(['INSTANT', 'TWO_STEP']) transferMode?: string;
  @IsISO8601() documentDate!: string;
}

export class CreateBankFeeDto {
  @IsString() bankAccountId!: string;
  @IsOptional() @IsString() feeType?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsNumber() taxAmount?: number;
  @IsOptional() @IsString() statementLineId?: string;
  @IsISO8601() feeDate!: string;
}

export class CreateFXConversionDto {
  @IsString() sourceBankAccountId!: string;
  @IsString() destinationBankAccountId!: string;
  @IsString() sourceCurrencyId!: string;
  @IsNumber() sourceAmount!: number;
  @IsString() destinationCurrencyId!: string;
  @IsNumber() destinationAmount!: number;
  @IsNumber() tradeRate!: number;
  @IsOptional() @IsNumber() officialRate?: number;
  @IsOptional() @IsNumber() bankFeeAmount?: number;
  @IsOptional() @IsString() bankReference?: string;
  @IsISO8601() conversionDate!: string;
}

export class StatementLineDto {
  @IsISO8601() transactionDate!: string;
  @IsOptional() @IsISO8601() valueDate?: string;
  @IsOptional() @IsISO8601() bookingDate?: string;
  @IsOptional() @IsString() externalTransactionId?: string;
  @IsOptional() @IsString() bankReference?: string;
  @IsIn(['CREDIT', 'DEBIT']) direction!: 'CREDIT' | 'DEBIT';
  @IsNumber() amount!: number;
  @IsString() currencyId!: string;
  @IsOptional() @IsNumber() baseAmount?: number;
  @IsOptional() @IsString() counterpartyName?: string;
  @IsOptional() @IsString() counterpartyAccount?: string;
  @IsOptional() @IsString() counterpartyTaxId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() bankOperationCode?: string;
}

export class ImportBankStatementDto {
  @IsString() bankAccountId!: string;
  @IsOptional() @IsString() statementNumber?: string;
  @IsISO8601() statementDate!: string;
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
  @IsNumber() openingBalance!: number;
  @IsNumber() closingBalance!: number;
  @IsString() currencyId!: string;
  @IsOptional() @IsString() importSource?: string;
  @IsOptional() @IsString() externalStatementId?: string;
  @IsOptional() @IsString() rawPayload?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StatementLineDto) lines!: StatementLineDto[];
}

export class ManualMatchDto {
  @IsString() matchedDocumentType!: string;
  @IsString() matchedDocumentId!: string;
}
