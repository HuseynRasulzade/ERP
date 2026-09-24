import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() parentCategoryId?: string;
  @IsOptional() @IsString() parentGroupId?: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateProductCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() parentCategoryId?: string;
  @IsOptional() @IsString() parentGroupId?: string;
  @IsOptional() @IsString() description?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
