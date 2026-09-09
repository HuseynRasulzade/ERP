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
  @ValidateNested({ each: true })
  @Type(() => SalesLineItemDto)
  lines?: SalesLineItemDto[];

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class SalesDocumentCommandDto extends VersionedCommandDto {}
