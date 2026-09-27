import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

const RESOLUTION_TYPES = [
  'ADJUST_STOCK',
  'LOCATION_TRANSFER',
  'STATUS_TRANSFER',
  'BATCH_CORRECTION',
  'SERIAL_CORRECTION',
  'NO_ADJUSTMENT',
  'SOURCE_DOCUMENT_CORRECTION',
  'WRITE_OFF',
  'SURPLUS_RECOGNITION',
];

const REASON_CODES = [
  'counting_error',
  'document_not_posted',
  'wrong_location',
  'wrong_batch',
  'unrecorded_receipt',
  'unrecorded_issue',
  'theft',
  'damage',
  'expiry',
  'production_variance',
  'data_migration',
  'packaging_conversion_error',
  'serial_mismatch',
  'unknown',
  'other',
];

export class RequestInventoryRecountDto {
  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SubmitInventoryRecountDto {
  @IsNumber()
  physicalQuantity!: number;

  @IsOptional()
  @IsString()
  countedBy?: string;
}

export class DecideVarianceDto {
  @IsIn(RESOLUTION_TYPES)
  resolutionType!: string;

  @IsOptional()
  @IsIn(REASON_CODES)
  reasonCode?: string;

  @IsOptional()
  @IsNumber()
  finalPhysicalQuantity?: number;

  @IsOptional()
  @IsNumber()
  approvedCost?: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class VarianceReasonChangeDto {
  @IsIn(REASON_CODES)
  reasonCode!: string;
}

export class CreateAdjustmentTargetDto {
  @IsString()
  varianceId!: string;

  @IsOptional()
  @IsString()
  targetLocationId?: string;

  @IsOptional()
  @IsString()
  targetQualityStatus?: string;
}

export class CreateAdjustmentsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdjustmentTargetDto)
  targets?: CreateAdjustmentTargetDto[];
}
