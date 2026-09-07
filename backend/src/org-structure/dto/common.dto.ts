import { IsInt, Min } from 'class-validator';

/** Shared by every deactivate/reactivate command in this module — optimistic
 * concurrency is enforced identically everywhere (section 68). */
export class VersionedCommandDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
