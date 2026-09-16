import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested, ArrayMinSize, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRED', 'CANCELLED'];

export class CreateCounterpartyContractDto {
  @IsString() number!: string;
  @IsString() subject!: string;
  @IsOptional() @IsString() contractType?: string;
  @IsOptional() @IsDateString() signedDate?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() notes?: string;

  // Commercial / delivery terms (spec section 10)
  @IsOptional() @IsBoolean() hasAdvance?: boolean;
  @IsOptional() @IsNumber() advancePercent?: number;
  @IsOptional() @IsInt() remainingPaymentDueDays?: number;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsInt() deliveryTermDays?: number;
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsString() deliveryTerms?: string;
  @IsOptional() @IsString() warrantyPeriod?: string;
  @IsOptional() @IsString() penaltyTerms?: string;
  @IsOptional() @IsString() otherTerms?: string;
  @IsOptional() @IsBoolean() priceIncludesTax?: boolean;
  @IsOptional() @IsNumber() limitAmount?: number;
  @IsOptional() @IsIn(['WARN', 'BLOCK', 'APPROVAL']) limitPolicy?: string;
}

export class UpdateCounterpartyContractDto {
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() contractType?: string;
  @IsOptional() @IsDateString() signedDate?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() notes?: string;

  @IsOptional() @IsBoolean() hasAdvance?: boolean;
  @IsOptional() @IsInt() remainingPaymentDueDays?: number;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsInt() deliveryTermDays?: number;
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsString() deliveryTerms?: string;
  @IsOptional() @IsString() warrantyPeriod?: string;
  @IsOptional() @IsString() penaltyTerms?: string;
  @IsOptional() @IsString() otherTerms?: string;
  @IsOptional() @IsBoolean() priceIncludesTax?: boolean;
  @IsOptional() @IsNumber() limitAmount?: number;
  @IsOptional() @IsIn(['WARN', 'BLOCK', 'APPROVAL']) limitPolicy?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}

/** Not a free-form "add any product" input any more — a contract line can
 * only ever be pulled back in from the contract's own source purchase
 * order (spec: manual nomenclature entry outside the PO is not allowed).
 * `quantity` defaults to that PO line's live remaining quantity when
 * omitted. Product/unit/price are always derived server-side from the PO
 * line — never accepted from the client. */
export class CreateContractLineDto {
  @IsString() sourceOrderLineId!: string;
  @IsOptional() @IsNumber() quantity?: number;
}

export class UpdateContractLineDto {
  // Note: productId/unitId are deliberately absent — nomenclature name,
  // code, and unit always come from the source PO line and cannot be
  // changed on the contract (spec section 11). Only quantity (capped at
  // the PO line's remaining quantity) and pricing fields are editable.
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() unitPrice?: number;
  @IsOptional() @IsNumber() discountPercent?: number;
  @IsOptional() @IsString() description?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}

export class SetContractSourcePurchaseOrderDto {
  @IsString() purchaseOrderId!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}

export class SetContractAdvanceDto {
  @IsOptional() @IsBoolean() hasAdvance?: boolean;
  @IsOptional() @IsNumber() advancePercent?: number | null;
  @IsOptional() @IsNumber() advanceAmount?: number | null;
  @IsInt() @Min(1) expectedVersion!: number;
}

export class PaymentInstallmentItemDto {
  @IsDateString() dueDate!: string;
  @IsIn(['ADVANCE', 'AFTER_DELIVERY', 'AFTER_INVOICE'])
  basis!: string;
  @IsOptional() @IsNumber() percentage?: number;
  @IsOptional() @IsNumber() amount?: number;
}

export class GenerateContractPaymentScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentInstallmentItemDto)
  installments!: PaymentInstallmentItemDto[];
}

export class CreateContractFromPurchaseOrderLineDto {
  @IsString() purchaseOrderLineId!: string;
  @IsOptional() @IsNumber() quantity?: number;
}

export class CreateContractFromPurchaseOrderDto {
  @IsString() purchaseOrderId!: string;
  @IsString() number!: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateContractFromPurchaseOrderLineDto)
  lines?: CreateContractFromPurchaseOrderLineDto[];
}

export class SetContractStatusDto {
  @IsIn(STATUSES) status!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}

export class CreateContractAmendmentDto {
  @IsString() number!: string;
  @IsString() subject!: string;
  @IsOptional() @IsDateString() amendmentDate?: string;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() newAmount?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() changeDescription?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateContractAmendmentDto {
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsDateString() amendmentDate?: string;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() newAmount?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() changeDescription?: string;
  @IsOptional() @IsString() notes?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}

export class SetAmendmentStatusDto {
  @IsIn(STATUSES) status!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
