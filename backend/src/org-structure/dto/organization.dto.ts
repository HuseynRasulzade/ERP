import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional() @IsString() fullLegalName?: string;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() legalForm?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() registeredAddress?: string;
  @IsOptional() @IsString() actualAddress?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() baseCurrencyId?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;
}

export class UpdateOrganizationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() fullLegalName?: string;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() legalForm?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() registeredAddress?: string;
  @IsOptional() @IsString() actualAddress?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() baseCurrencyId?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class DeactivateOrganizationDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class SetOrganizationDefaultDto {
  @IsIn(['defaultBranchId', 'defaultWarehouseId', 'defaultCashboxId', 'defaultBankAccountId'])
  field!: 'defaultBranchId' | 'defaultWarehouseId' | 'defaultCashboxId' | 'defaultBankAccountId';

  @IsOptional()
  @IsString()
  targetId?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class GrantOrganizationAccessDto {
  @IsString()
  membershipId!: string;

  @IsOptional()
  @IsIn(['FULL', 'READ'])
  accessLevel?: string;

  /** This membership's home department within the organization — used to
   * auto-fill the department on documents the user creates. Pass null to
   * clear an existing assignment. */
  @IsOptional()
  @IsString()
  departmentId?: string | null;
}
