import { IsArray, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

const ENTRY_METHODS = ['MANUAL', 'BARCODE', 'IMPORT', 'MOBILE', 'API', 'SYSTEM_RECOUNT'];

export class SubmitInventoryCountEntryDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  ownershipType?: string;

  @IsOptional()
  @IsString()
  qualityStatus?: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  countedQuantity!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @IsOptional()
  @IsIn(ENTRY_METHODS)
  entryMethod?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  clientEntryId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
