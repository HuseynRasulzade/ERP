import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Min, ValidateIf } from 'class-validator';

// Azerbaijan VÖEN: exactly 10 digits.
export const VOEN_PATTERN = /^\d{10}$/;
// Loose international phone format — digits, spaces, +()- separators, 7-20 chars total.
export const PHONE_PATTERN = /^[+]?[\d\s().-]{7,20}$/;

export class CreateCounterpartyDto {
  @IsString() counterpartyType!: string; // CUSTOMER | SUPPLIER | BOTH
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() fullLegalName?: string;

  // Residency (spec section 2): RESIDENT requires a local VÖEN (validated
  // + unique per organization in the service); NON_RESIDENT never
  // requires one — `foreignTaxId` covers it instead.
  @IsOptional()
  @IsIn(['RESIDENT', 'NON_RESIDENT'])
  residencyStatus?: string;

  // Format is only checked when a value is actually provided — creation
  // itself never requires these fields (spec section 8: a document may be
  // saved incomplete as DRAFT; only the `approve` command enforces
  // completeness — see CounterpartyService.approve).
  @ValidateIf((o) => o.taxId !== undefined && o.taxId !== null && o.taxId !== '')
  @Matches(VOEN_PATTERN, { message: 'VÖEN must be exactly 10 digits' })
  @IsOptional()
  taxId?: string;

  @IsOptional() @IsString() foreignTaxId?: string;

  @IsOptional() @IsBoolean() vatPayer?: boolean;

  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'Invalid phone number format' }) phone?: string;
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

  @IsOptional() @IsIn(['RESIDENT', 'NON_RESIDENT']) residencyStatus?: string;
  @ValidateIf((o) => o.taxId !== undefined && (!o.residencyStatus || o.residencyStatus === 'RESIDENT'))
  @Matches(VOEN_PATTERN, { message: 'VÖEN must be exactly 10 digits' })
  @IsOptional()
  taxId?: string;
  @IsOptional() @IsString() foreignTaxId?: string;
  @IsOptional() @IsBoolean() vatPayer?: boolean;
  @IsOptional() @IsString() countryCode?: string;

  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'Invalid phone number format' }) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsInt() paymentTerms?: number;
  @IsOptional() @IsNumber() creditLimit?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() notes?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}

export class CreateCounterpartyAddressDto {
  @IsString() addressType!: string; // LEGAL | ACTUAL | SHIPPING | BILLING | OTHER
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
  @IsOptional() @IsString() department?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'Invalid phone number format' }) phone?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'Invalid phone number format' }) mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UpdateCounterpartyContactDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'Invalid phone number format' }) phone?: string;
  @IsOptional() @Matches(PHONE_PATTERN, { message: 'Invalid phone number format' }) mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;

  @IsInt() @Min(1) expectedVersion!: number;
}

export class CreateCounterpartyBankAccountDto {
  @IsString() bankName!: string;
  @IsOptional() @IsString() bankTaxId?: string;
  @IsOptional() @IsString() bankCode?: string;
  @IsOptional() @IsString() bankAddress?: string;
  @IsString() accountNumber!: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() correspondentAccount?: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateCounterpartyBankAccountDto {
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankTaxId?: string;
  @IsOptional() @IsString() bankCode?: string;
  @IsOptional() @IsString() bankAddress?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() correspondentAccount?: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;

  @IsInt() @Min(1) expectedVersion!: number;
}

export class RejectCounterpartyBankAccountDto {
  @IsOptional() @IsString() reason?: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
