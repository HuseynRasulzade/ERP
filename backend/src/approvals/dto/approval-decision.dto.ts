import { IsOptional, IsString } from 'class-validator';

/** Approval decisions are guarded by the ApprovalStep's own PENDING status
 * (ApprovalService uses a conditional updateMany, same optimistic-
 * concurrency discipline as everywhere else in this codebase) rather than
 * the parent document's `version` — a concurrent document edit and a
 * concurrent approval decision are different operations on different rows. */
export class ApprovalDecisionDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
