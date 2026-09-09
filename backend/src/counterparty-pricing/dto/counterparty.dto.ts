import { IsBoolean, IsEmail, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCounterpartyDto {
  @IsString() counterpartyType!: string; // CUSTOMER | SUPPLIER | BOTH
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() fullLegalName?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsInt() paymentTerms?: number;
  @IsOptional() @IsNumber() creditLimit?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateCounterpartyDto {
  @IsOptional() @IsString() counterpartyType?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() fullLegalName?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsInt() paymentTerms?: number;
  @IsOptional() @IsNumber() creditLimit?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() notes?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}

export class CreateCounterpartyAddressDto {
  @IsString() addressType!: string; // LEGAL | SHIPPING | BILLING | OTHER
  @IsString() addressLine1!: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsString() city!: string;
  @IsOptional() @IsString() stateProvince?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class CreateCounterpartyContactDto {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
