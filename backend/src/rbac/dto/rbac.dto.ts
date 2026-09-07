import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes!: string[];
}

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes!: string[];
}
