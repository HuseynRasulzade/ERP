import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBankDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() correspondentAccount?: string;
  @IsOptional() @IsString() address?: string;
}

export class UpdateBankDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() correspondentAccount?: string;
  @IsOptional() @IsString() address?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
