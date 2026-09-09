import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePriceListDto {
  @IsString() priceListType!: string; // SALE | PURCHASE
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() currencyId!: string;
  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() includesTax?: boolean;
}

export class UpdatePriceListDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() includesTax?: boolean;

  @IsInt() @Min(1) expectedVersion!: number;
}

export class CreateProductPriceDto {
  @IsString() productId!: string;
  @IsString() unitId!: string;
  @IsNumber() price!: number;
  @IsOptional() @IsNumber() minQuantity?: number;
  @IsOptional() @IsNumber() maxQuantity?: number;
}

export class UpdateProductPriceDto {
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsNumber() minQuantity?: number;
  @IsOptional() @IsNumber() maxQuantity?: number;

  @IsInt() @Min(1) expectedVersion!: number;
}
