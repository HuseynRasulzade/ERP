import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

export type ImportMode = 'CREATE_ONLY' | 'UPDATE_IF_UNPOSTED' | 'UPSERT_MASTER_DATA' | 'SYNC_STATE' | 'REFERENCE_ONLY' | 'COMMAND_EVENT';
export type ImportRecordStatus = 'CREATED' | 'UPDATED' | 'SKIPPED' | 'DUPLICATE' | 'REJECTED' | 'FAILED' | 'WAITING_MANUAL';

/** Every domain command result reports which of these happened —
 * `IntegrationImportService` never assumes success. */
export interface DomainCommandResult {
  status: ImportRecordStatus;
  targetEntityType?: string;
  targetEntityId?: string;
  rejectionReason?: string;
}

/** The actor context every domain command receives so downstream
 * services/audit can distinguish an integration-originated action from
 * a human one (spec section 133 — `actor_type = INTEGRATION`). */
export interface IntegrationActorContext {
  // 'AI_ASSISTED' (Phase 29) — the same handler contract, so an
  // AI-approved action proposal executes through the identical
  // deterministic domain command path a governed import uses, never a
  // separate AI-specific bypass (docs/AI_LAYER.md section B).
  actorType: 'INTEGRATION' | 'AI_ASSISTED';
  endpointId: string;
  serviceAccountUserId: string;
  messageId?: string;
}

/**
 * A business module registers one of these per canonical contract code
 * it accepts imports for (spec sections 54-55, 166 — "Integration layer
 * must call SalesService/PurchaseService/... ; target domain performs
 * permissions/business validations/posting rules"). The handler's
 * `execute` is the ONLY way `IntegrationImportService` ever creates or
 * changes a business record — there is no raw-SQL/Prisma fallback path
 * (spec's own repeated "never write directly to business tables" rule).
 * No handlers are pre-registered in this build (disclosed, matching the
 * same narrow-extension-point pattern as Phase 27's
 * `SourceEligibilityAdapter`/`DocumentRepositoryAdapter`).
 */
export interface IntegrationCommandHandler {
  readonly contractCode: string;

  execute(
    tenantId: string,
    actor: IntegrationActorContext,
    canonicalData: Record<string, unknown>,
    mode: ImportMode,
    tx: PrismaTransactionClient,
  ): Promise<DomainCommandResult>;
}

@Injectable()
export class IntegrationCommandRegistry {
  private readonly handlers = new Map<string, IntegrationCommandHandler>();

  register(handler: IntegrationCommandHandler) {
    if (this.handlers.has(handler.contractCode)) throw new Error(`Command handler already registered for contract '${handler.contractCode}'`);
    this.handlers.set(handler.contractCode, handler);
  }

  get(contractCode: string): IntegrationCommandHandler {
    const handler = this.handlers.get(contractCode);
    if (!handler) throw new ValidationAppError(`No domain command handler registered for contract '${contractCode}' — the integration layer cannot import this contract yet`);
    return handler;
  }

  has(contractCode: string): boolean {
    return this.handlers.has(contractCode);
  }
}
