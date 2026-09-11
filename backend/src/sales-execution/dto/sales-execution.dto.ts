import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ShipmentLineDto {
  @IsOptional() @IsString() sourceOrderLineId?: string;
  @IsString() productId!: string;
  @IsString() unitId!: string;
  @IsNumberString() quantity!: string;
  @IsOptional() @IsString() warehouseId?: string;
  // Phase 10 — batch/serial issue (spec sections 19-23). `batchId` picks
  // an existing Batch to issue from; `serialNumbers` names the specific
  // existing serials to issue (each validated AVAILABLE at this
  // shipment's warehouse at posting time).
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serialNumbers?: string[];
  @IsOptional() @IsString() notes?: string;
}

export class CreateShipmentDto {
  @IsDateString() documentDate!: string;
  @IsString() counterpartyId!: string;
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() customerOrderId?: string;
  @IsOptional() @IsString() deliveryAddressSnapshot?: string;
  @IsOptional() @IsString() description?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineDto)
  lines!: ShipmentLineDto[];
}

export class VersionedCommandDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class SalesReturnLineDto {
  @IsOptional() @IsString() sourceInvoiceLineId?: string;
  @IsString() productId!: string;
  @IsString() unitId!: string;
  @IsNumberString() quantity!: string;
  // Phase 10 — the returned batch/serials come back into stock at the
  // return's warehouse (see BatchSerialService.returnSerials).
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serialNumbers?: string[];
  @IsOptional() @IsString() reason?: string;
}

export class CreateSalesReturnDto {
  @IsDateString() documentDate!: string;
  @IsString() counterpartyId!: string;
  @IsOptional() @IsString() originalSalesInvoiceId?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsIn(['PHYSICAL_RETURN', 'FINANCIAL_CREDIT_ONLY', 'PRICE_CORRECTION']) returnType?: string;
  @IsOptional() @IsString() reasonCode?: string;
  @IsOptional() @IsString() description?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesReturnLineDto)
  lines!: SalesReturnLineDto[];
}
