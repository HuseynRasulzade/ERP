import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductParentCategoryDto {
  @IsString() name!: string;
}

export class UpdateProductParentCategoryDto {
  @IsOptional() @IsString() name?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
