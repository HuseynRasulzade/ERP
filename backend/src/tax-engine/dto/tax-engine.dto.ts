import { IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CalculateTaxDto {
  @IsIn(['SALE', 'PURCHASE']) operationType!: 'SALE' | 'PURCHASE';
  @IsString() taxCategoryCode!: string;
  @IsIn(['SELLER', 'BUYER', 'SELF_ASSESSED']) taxpayerSide!: 'SELLER' | 'BUYER' | 'SELF_ASSESSED';
  @IsNumberString() amount!: string;
  @IsBoolean() priceIncludesTax!: boolean;
  @IsDateString() taxPointDate!: string;
  @IsOptional() @IsString() sourceLineId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumberString() recoverablePercent?: string;
}

export class CreateTaxRegistrationDto {
  @IsString() taxType!: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsIn(['REGISTERED', 'NOT_REGISTERED', 'SUSPENDED']) status?: string;
}
