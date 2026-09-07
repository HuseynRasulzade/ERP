import { IsInt, Min } from 'class-validator';

/** Every state-changing command requires the version the client last saw
 * (section 14/62) — a client can never flip posting status by PATCHing a
 * field; it must go through one of these explicit commands. */
export class DocumentCommandDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
