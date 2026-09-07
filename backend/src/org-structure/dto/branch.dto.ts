import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBranchDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() managerPersonId?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() managerPersonId?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
