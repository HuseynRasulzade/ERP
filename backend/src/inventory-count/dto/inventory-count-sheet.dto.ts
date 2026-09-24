import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ManualInventoryCountSheetDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;
}

export class GenerateInventoryCountSheetsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualInventoryCountSheetDto)
  extraSheets?: ManualInventoryCountSheetDto[];
}

export class AssignInventoryCountSheetDto {
  @IsString()
  assignedUserId!: string;
}
