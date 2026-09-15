import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface SoDCheckResult {
  allowed: boolean;
  violatedRule?: string;
  severity?: string;
  overridable?: boolean;
}

/**
 * SegregationOfDutiesService (docx spec Phase 26, sections 39-44). Four-
 * eyes (creator can never be the sole/final approver of their own
 * request, spec section 39-40) is enforced as the built-in
 * `CREATOR_NOT_APPROVER` check regardless of whether a tenant has
 * configured an explicit `SegregationRule` row for the category —
 * additional relations (`APPROVER_NOT_EXECUTOR`, ...) require an
 * explicit configured rule. Checked at assignment, at decision, and
 * again immediately before execution (spec section 43), since roles can
 * change mid-workflow.
 */
@Injectable()
export class SegregationOfDutiesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Built-in four-eyes: the initiator of the workflow can never be one
   * of its own approvers, unless a fallback explicitly opts out (never
   * the default, spec section 39). */
  checkFourEyes(initiatorUserId: string, candidateApproverUserId: string): SoDCheckResult {
    if (initiatorUserId === candidateApproverUserId) return { allowed: false, violatedRule: 'CREATOR_NOT_APPROVER', severity: 'BLOCKING', overridable: false };
    return { allowed: true };
  }

  /** Configured relation checks for a given action category — e.g.
   * APPROVER_NOT_EXECUTOR when a payment's final approver attempts to
   * also be the one triggering bank execution (spec section 41). */
  async checkRelation(tenantId: string, actionCategory: string, relation: string, actorAUserId: string, actorBUserId: string): Promise<SoDCheckResult> {
    if (actorAUserId !== actorBUserId) return { allowed: true };
    const rule = await this.prisma.segregationRule.findFirst({ where: { tenantId, actionCategory, conflictingRelation: relation, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] } });
    if (!rule) return { allowed: true }; // no configured rule for this relation — not violated by default
    return { allowed: false, violatedRule: relation, severity: rule.severity, overridable: rule.overridePolicy === 'REQUIRES_SEPARATE_APPROVER_AND_REASON' };
  }

  /** An override always requires an explicit reason and is itself
   * audited by the caller — never silent (spec section 44). */
  assertOverridable(result: SoDCheckResult, reason?: string): void {
    if (result.allowed) return;
    if (!result.overridable) throw new ValidationAppError(`Segregation-of-duties violation (${result.violatedRule}) cannot be overridden.`);
    if (!reason) throw new ValidationAppError(`Overriding segregation-of-duties rule ${result.violatedRule} requires an explicit reason.`);
  }
}
