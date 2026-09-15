import { Injectable } from '@nestjs/common';
import { ExternalEntityReferenceService } from './external-entity-reference.service';

export type MatchMethod = 'EXACT_CODE' | 'TAX_ID' | 'EMAIL' | 'BARCODE' | 'IBAN' | 'SUPPLIER_CODE';

/** A business module registers one of these per internal entity type so
 * matching can attempt candidate resolution when no `ExternalEntityReference`
 * yet exists (spec section 43). No adapters are pre-registered in this
 * build — an unregistered internal entity type always falls back to
 * `WAITING_MANUAL` (disclosed, matching this codebase's established
 * "narrow extension point, no adapters shipped" pattern from Phase 27's
 * `SourceEligibilityAdapter`). */
export interface EntityMatchCandidateResolver {
  readonly internalEntityType: string;
  findCandidate(tenantId: string, method: MatchMethod, value: string): Promise<{ internalEntityId: string; confidence: number } | null>;
}

export interface MatchAttemptResult {
  status: 'MATCHED' | 'UNMATCHED' | 'WAITING_MANUAL' | 'LOW_CONFIDENCE';
  internalEntityId?: string;
  matchMethod?: MatchMethod;
  confidence?: number;
}

/**
 * IntegrationMatchingService (docx spec Phase 28, sections 43-46).
 * Below-threshold or heuristic matches are NEVER silently auto-linked
 * (spec section 44) — `attemptMatch` only returns a result; only an
 * explicit caller decision (`ExternalEntityReferenceService.link`, from
 * either an auto-accepted high-confidence match or the manual matching
 * workbench) actually creates the reference.
 */
@Injectable()
export class IntegrationMatchingService {
  private readonly resolvers = new Map<string, EntityMatchCandidateResolver>();
  private readonly autoLinkConfidenceThreshold = 0.95;

  constructor(private readonly externalRefs: ExternalEntityReferenceService) {}

  registerResolver(resolver: EntityMatchCandidateResolver) {
    this.resolvers.set(resolver.internalEntityType, resolver);
  }

  async attemptMatch(tenantId: string, internalEntityType: string, candidates: { method: MatchMethod; value: string }[]): Promise<MatchAttemptResult> {
    const resolver = this.resolvers.get(internalEntityType);
    if (!resolver) return { status: 'WAITING_MANUAL' };

    for (const candidate of candidates) {
      const found = await resolver.findCandidate(tenantId, candidate.method, candidate.value);
      if (!found) continue;
      if (found.confidence >= this.autoLinkConfidenceThreshold) {
        return { status: 'MATCHED', internalEntityId: found.internalEntityId, matchMethod: candidate.method, confidence: found.confidence };
      }
      return { status: 'LOW_CONFIDENCE', internalEntityId: found.internalEntityId, matchMethod: candidate.method, confidence: found.confidence };
    }
    return { status: 'UNMATCHED' };
  }
}
