import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { VersionedCommandDto } from '../../org-structure/dto/common.dto';

export class SalesLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  quantity!: number;

  /** Optional explicit price. When omitted, resolvePrice() fills it from SALE lists. */
  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @IsOptional()
  @IsString()
  description?: string;

  /** Sales Execution (docx spec Phase 7, sections 21-25): links an
   * invoice line back to the order/shipment line it executes, so
   * SalesInvoicePostingHandler can enforce the remaining-invoiceable-
   * quantity cap and write the ORDER_TO_INVOICE/SHIPMENT_TO_INVOICE
   * DocumentLineLink. Ignored on a SalesOrder line (orders have no
   * "source" of their own). */
  @IsOptional()
  @IsString()
  sourceOrderLineId?: string;

  @IsOptional()
  @IsString()
  sourceShipmentLineId?: string;

  /** Line-level override of the order's own warehouse — falls back to
   * the header's warehouseId when omitted (see SalesOrderToShipmentMapper). */
  @IsOptional()
  @IsString()
  warehouseId?: string;

  /** Services never ship (SalesOrderToShipmentMapper skips them) and
   * are exempt from reservation/fulfillment tracking. */
  @IsOptional()
  @IsBoolean()
  isService?: boolean;

  @IsOptional()
  @IsString()
  reservationPolicy?: string;

  @IsOptional()
  @IsString()
  fulfillmentPolicy?: string;
}

export class CreateSalesOrderDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  /** Required before a Shipment can ever be created from this order —
   * see SalesOrderToShipmentMapper.mapHeader. */
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional() @IsString() salesChannel?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() externalReference?: string;
  @IsOptional() @IsDateString() requestedDeliveryDate?: string;
  @IsOptional() @IsDateString() promisedDeliveryDate?: string;
  @IsOptional() @IsString() shipmentPaymentPolicy?: string;

  @ValidateNested({ each: true })
  @Type(() => SalesLineItemDto)
  @ArrayMinSize(1)
  lines!: SalesLineItemDto[];
}

export class UpdateSalesOrderDto {
  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional() @IsString() salesChannel?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() externalReference?: string;
  @IsOptional() @IsDateString() requestedDeliveryDate?: string;
  @IsOptional() @IsDateString() promisedDeliveryDate?: string;
  @IsOptional() @IsString() shipmentPaymentPolicy?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SalesLineItemDto)
  lines?: SalesLineItemDto[];

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateSalesInvoiceDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  /** Manual override for the tax point date used to resolve VAT rates at
   * posting time — see SalesInvoicePostingHandler (`invoice.taxPointDate
   * ?? businessDate`). Left unset, posting falls back to the business
   * date exactly as before this field existed. */
  @IsOptional()
  @IsDateString()
  taxPointDate?: string;

  @ValidateNested({ each: true })
  @Type(() => SalesLineItemDto)
  @ArrayMinSize(1)
  lines!: SalesLineItemDto[];
}

export class UpdateSalesInvoiceDto {
  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  taxPointDate?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SalesLineItemDto)
  lines?: SalesLineItemDto[];

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class SalesDocumentCommandDto extends VersionedCommandDto {}
