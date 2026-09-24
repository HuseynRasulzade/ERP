import { IsOptional, IsString } from 'class-validator';

export class StartInventoryCountSessionDto {
  @IsString()
  inventoryCountPlanId!: string;

  @IsOptional()
  @IsString()
  countCutoffAt?: string;
}
