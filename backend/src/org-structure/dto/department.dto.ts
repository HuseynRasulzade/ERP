import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateDepartmentDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() parentDepartmentId?: string;
  @IsOptional() @IsString() managerPersonId?: string;
}

export class UpdateDepartmentDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() parentDepartmentId?: string;
  @IsOptional() @IsString() managerPersonId?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
