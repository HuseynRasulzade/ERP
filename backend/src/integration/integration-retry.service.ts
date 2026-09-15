import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ErrorCategory = 'TRANSIENT_NETWORK' | 'RATE_LIMIT' | 'AUTHENTICATION' | 'PROVIDER_5XX' | 'SCHEMA_ERROR' | 'MAPPING_ERROR' | 'BUSINESS_VALIDATION' | 'DUPLICATE' | 'CONFLICT' | 'INTERNAL_ERROR';

const DEFAULT_RETRYABLE: ErrorCategory[] = ['TRANSIENT_NETWORK', 'RATE_LIMIT', 'PROVIDER_5XX'];

/**
 * IntegrationRetryService (docx spec Phase 28, sections 66-68, 111-114).
 * Retries only TRANSIENT technical failures — business validation
 * failures, duplicates, and conflicts never get an automatic retry loop
 * (spec section 66's own explicit split), preventing the "retryable and
 * permanent business error sent to the same infinite retry queue"
 * anti-pattern the spec calls out (section 238).
 */
@Injectable()
export class IntegrationRetryService {
  constructor(private readonly prisma: PrismaService) {}

  isRetryable(errorCategory: ErrorCategory, retryableCategories?: ErrorCategory[]): boolean {
    return (retryableCategories ?? DEFAULT_RETRYABLE).includes(errorCategory);
  }

  /** Exponential (default) or fixed backoff with an optional jitter,
   * capped at `maxDelaySeconds`. */
  computeNextDelaySeconds(attemptNumber: number, policy: { initialDelaySeconds: number; backoffStrategy: string; maxDelaySeconds: number; jitterPolicy: string }): number {
    const raw = policy.backoffStrategy === 'FIXED' ? policy.initialDelaySeconds : policy.initialDelaySeconds * Math.pow(2, attemptNumber - 1);
    const capped = Math.min(raw, policy.maxDelaySeconds);
    if (policy.jitterPolicy === 'FULL') return Math.random() * capped;
    if (policy.jitterPolicy === 'EQUAL') return capped / 2 + Math.random() * (capped / 2);
    return capped;
  }

  async getPolicy(tenantId: string, retryPolicyId: string | null) {
    if (!retryPolicyId) return { maxAttempts: 5, initialDelaySeconds: 30, backoffStrategy: 'EXPONENTIAL', maxDelaySeconds: 3600, jitterPolicy: 'NONE', retryableErrorCategories: DEFAULT_RETRYABLE as string[] };
    const row = await this.prisma.integrationRetryPolicy.findFirst({ where: { id: retryPolicyId, tenantId } });
    if (!row) return { maxAttempts: 5, initialDelaySeconds: 30, backoffStrategy: 'EXPONENTIAL', maxDelaySeconds: 3600, jitterPolicy: 'NONE', retryableErrorCategories: DEFAULT_RETRYABLE as string[] };
    return { maxAttempts: row.maxAttempts, initialDelaySeconds: row.initialDelaySeconds, backoffStrategy: row.backoffStrategy, maxDelaySeconds: row.maxDelaySeconds, jitterPolicy: row.jitterPolicy, retryableErrorCategories: (row.retryableErrorCategories as unknown as string[]) };
  }

  async createPolicy(tenantId: string, input: { code: string; maxAttempts?: number; initialDelaySeconds?: number; backoffStrategy?: string; maxDelaySeconds?: number; retryableErrorCategories?: ErrorCategory[]; jitterPolicy?: string }) {
    return this.prisma.integrationRetryPolicy.create({
      data: {
        tenantId,
        code: input.code,
        maxAttempts: input.maxAttempts ?? 5,
        initialDelaySeconds: input.initialDelaySeconds ?? 30,
        backoffStrategy: input.backoffStrategy ?? 'EXPONENTIAL',
        maxDelaySeconds: input.maxDelaySeconds ?? 3600,
        retryableErrorCategories: (input.retryableErrorCategories ?? DEFAULT_RETRYABLE) as object,
        jitterPolicy: input.jitterPolicy ?? 'NONE',
      },
    });
  }
}
