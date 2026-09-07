import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateCashboxDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
}

export class UpdateCashboxDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
