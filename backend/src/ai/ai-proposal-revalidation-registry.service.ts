import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ValidationAppError } from '../common/errors/app-error';

export interface RevalidationResult {
  valid: boolean;
  currentEligibleAmount?: Decimal;
  reason?: string;
}

/** Registered per `actionType` (spec sections 46-47) — re-checks
 * whatever "remaining eligibility" concept that action type depends on
 * (e.g. Phase 27's `RemainingToCreateService` for a document-chain-
 * shaped proposal, or Phase 13's open-item balance for a payment
 * proposal) at the moment just before execution. No adapters ship
 * pre-registered (the same narrow-extension-point pattern used
 * throughout this codebase) — an action type with none registered is
 * always treated as needing manual re-check, never silently assumed
 * still valid. */
export interface AIProposalRevalidationAdapter {
  readonly actionType: string;
  revalidate(tenantId: string, proposedCommand: Record<string, unknown>): Promise<RevalidationResult>;
}

@Injectable()
export class AIProposalRevalidationRegistry {
  private readonly adapters = new Map<string, AIProposalRevalidationAdapter>();

  register(adapter: AIProposalRevalidationAdapter) {
    this.adapters.set(adapter.actionType, adapter);
  }

  async revalidate(tenantId: string, actionType: string, proposedCommand: Record<string, unknown>): Promise<RevalidationResult> {
    const adapter = this.adapters.get(actionType);
    if (!adapter) throw new ValidationAppError(`No revalidation adapter registered for action type '${actionType}' — cannot safely re-check eligibility before execution`);
    return adapter.revalidate(tenantId, proposedCommand);
  }
}
