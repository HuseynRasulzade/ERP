import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploadCounterpartyDocumentDto {
  @IsIn(['CONTRACT', 'CONTRACT_AMENDMENT'])
  ownerType!: string;

  @IsString()
  ownerId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
