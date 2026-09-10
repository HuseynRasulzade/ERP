import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CustomerRequestLineDto {
  @IsString() productId!: string;
  @IsString() unitId!: string;
  @IsNumberString() quantity!: string;
  @IsOptional() @IsNumberString() requestedPrice?: string;
  @IsOptional() @IsDateString() requestedDeliveryDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateCustomerRequestDto {
  @IsDateString() documentDate!: string;
  @IsString() counterpartyId!: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsDateString() requestedDeliveryDate?: string;
  @IsOptional() @IsString() salesManagerId?: string;
  @IsOptional() @IsString() sourceChannel?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() externalReference?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerRequestLineDto)
  lines!: CustomerRequestLineDto[];
}

export class CommercialOfferLineDto {
  @IsString() productId!: string;
  @IsString() unitId!: string;
  @IsNumberString() quantity!: string;
  @IsOptional() @IsNumberString() price?: string;
  @IsOptional() @IsNumberString() discountPercent?: string;
  @IsOptional() @IsString() taxCategoryCode?: string;
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateCommercialOfferDto {
  @IsDateString() documentDate!: string;
  @IsOptional() @IsDateString() validUntil?: string;
  @IsString() counterpartyId!: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() priceIncludesTax?: boolean;
  @IsOptional() @IsString() description?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommercialOfferLineDto)
  lines!: CommercialOfferLineDto[];
}

export class VersionedCommandDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class ReserveLineDto {
  @IsString() salesOrderLineId!: string;
  @IsString() warehouseId!: string;
  @IsNumberString() quantity!: string;
  @IsOptional() @IsDateString() validUntil?: string;
}

export class CreateReservationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReserveLineDto)
  lines!: ReserveLineDto[];
}

export class ShipmentPlanLineDto {
  @IsString() salesOrderLineId!: string;
  @IsNumberString() plannedQuantity!: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsDateString() plannedDate?: string;
}

export class CreateShipmentPlanDto {
  @IsDateString() plannedDate!: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsString() carrier?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentPlanLineDto)
  lines!: ShipmentPlanLineDto[];
}

export class PaymentScheduleInstallmentDto {
  @IsDateString() dueDate!: string;
  @IsOptional() @IsNumberString() percentage?: string;
  @IsOptional() @IsNumberString() amount?: string;
}

export class GeneratePaymentScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentScheduleInstallmentDto)
  installments!: PaymentScheduleInstallmentDto[];
}

export class PlaceOrderHoldDto {
  @IsIn(['CREDIT', 'CUSTOMER_REQUEST', 'STOCK', 'MANUAL', 'APPROVAL']) holdType!: string;
  @IsOptional() @IsString() reason?: string;
}
