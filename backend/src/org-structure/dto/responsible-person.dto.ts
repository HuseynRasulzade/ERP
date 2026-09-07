import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateResponsiblePersonDto {
  @IsString() displayName!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateResponsiblePersonDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() notes?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
