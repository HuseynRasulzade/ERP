import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

  @IsInt() @Min(1) expectedVersion!: number;
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
