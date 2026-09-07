import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBankAccountDto {
  @IsString() bankName!: string;
  @IsOptional() @IsString() bankCode?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsString() accountName!: string;
  @IsString() iban!: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsString() correspondentAccount?: string;
  @IsOptional() @IsString() accountType?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsDateString() openedDate?: string;
}

export class UpdateBankAccountDto {
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankCode?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsOptional() @IsString() accountName?: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() correspondentAccount?: string;
  @IsOptional() @IsString() accountType?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;

  @IsInt() @Min(1) expectedVersion!: number;
}
