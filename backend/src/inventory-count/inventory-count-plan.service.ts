import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_COUNT_PLAN_TYPE } from './inventory-count.constants';
import { CountScopeImmutableError } from './inventory-count.errors';
import { CreateInventoryCountPlanDto, InventoryCountPlanFieldsDto, UpdateInventoryCountPlanDto } from './dto/inventory-count.dto';
import { InventoryCountScopeService } from './inventory-count-scope.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';
import { InventorySnapshotService } from './inventory-snapshot.service';

const PLAN_SEQUENCE_PREFIX = 'IC';

const POLICY_FIELDS = [
  'branchId',
  'reason',
  'responsibleUserId',
  'countManagerId',
  'comment',
  'blindCountEnabled',
  'fullBlindCount',
  'blindRecount',
  'freezePolicy',
  'cutoffMode',
  'duplicateEntryPolicy',
  'repeatedScanMode',
  'uncountedPolicy',
  'requireFullCoverage',
  'recountPolicy',
  'maxRecountAttempts',
  'finalQuantityRule',
  'requireIndependentRecount',
  'autoAcceptWithinTolerance',
  'surplusCostPolicy',
  'shortageCostPolicy',
  'costingStrictness',
  'locationMismatchPolicy',
  'adjustmentDatePolicy',
  'stalePolicy',
  'approvalRequired',
  'forbidCounterApproval',
  'forbidWarehouseKeeperSelfApproval',
  'varianceApprovalPolicyId',
  'financialYear',
  'yearEndCount',
  'mandatoryCloseDependency',
] as const;
const DECIMAL_FIELDS = ['recountQuantityThreshold', 'recountValueThreshold', 'recountPercentThreshold', 'toleranceQuantity', 'tolerancePercent', 'toleranceValue', 'criticalShortageValue'] as const;

/**
 * InventoryCountPlanService (spec sections 4-6, 73, 108): plan header,
 * policies, scope rules and count team. Scope is editable only while the
 * plan is DRAFT (i.e. before a session has started); afterwards only the
 * controlled cancel/reopen path may revise it (spec section 6).
 */
@Injectable()
export class InventoryCountPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly access: OrganizationAccessService,
    private readonly scopes: InventoryCountScopeService,
    private readonly snapshots: InventorySnapshotService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, filter: { status?: string } = {}) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plans = await this.prisma.inventoryCountPlan.findMany({
      where: { tenantId, organizationId, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { scopes: { where: { active: true } } },
    });
    const sessionIds = plans.map((p) => p.currentSessionId).filter((x): x is string => !!x);
    const sessions = await this.prisma.inventoryCountSession.findMany({ where: { id: { in: sessionIds } } });
    const byId = new Map(sessions.map((s) => [s.id, s]));
    return plans.map((p) => ({ ...p, currentSession: p.currentSessionId ? byId.get(p.currentSessionId) ?? null : null }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plan = await this.prisma.inventoryCountPlan.findFirst({
      where: { id, tenantId, organizationId },
      include: { scopes: { orderBy: [{ revision: 'desc' }, { createdAt: 'asc' }] }, team: true, sessions: { orderBy: { startedAt: 'desc' } } },
    });
    if (!plan) throw new NotFoundAppError('InventoryCountPlan', id);
    const currentSession = plan.sessions.find((s) => s.id === plan.currentSessionId) ?? null;
    return { ...plan, currentSession };
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateInventoryCountPlanDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const planDate = this.parseDate(dto.planDate);
    this.validatePolicies(dto);
    if (dto.scope?.length) await this.scopes.validateRules(tenantId, organizationId, dto.scope);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, INVENTORY_COUNT_PLAN_TYPE, planDate, tx);
      const plan = await tx.inventoryCountPlan.create({
        data: {
          tenantId,
          organizationId,
          documentNumber: allocated.formatted,
          planDate,
          countType: dto.countType,
          plannedStartAt: dto.plannedStartAt ? new Date(dto.plannedStartAt) : undefined,
          plannedEndAt: dto.plannedEndAt ? new Date(dto.plannedEndAt) : undefined,
          ...this.policyData(dto),
          // An ANNUAL count is a year-end count by default (spec section 62).
          yearEndCount: dto.yearEndCount ?? dto.countType === 'ANNUAL',
          financialYear: dto.financialYear ?? (dto.countType === 'ANNUAL' ? planDate.getUTCFullYear() : undefined),
          createdBy: userId,
          updatedBy: userId,
        },
      });
      if (dto.scope?.length) await this.scopes.replaceRules(tenantId, plan.id, dto.scope, userId, tx);
      if (dto.team?.length) await this.replaceTeam(tenantId, plan.id, dto.team, userId, tx);

      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_PLAN_CREATED', entityType: INVENTORY_COUNT_PLAN_TYPE, entityId: plan.id, action: 'CREATE', userId, newValues: { documentNumber: plan.documentNumber, countType: plan.countType, scope: dto.scope ?? [] } }, tx);
      await this.events.emit(tenantId, InventoryCountEvents.PLANNED, { planId: plan.id }, { documentNumber: plan.documentNumber, countType: plan.countType }, tx);
      return tx.inventoryCountPlan.findFirst({ where: { id: plan.id }, include: { scopes: { where: { active: true } }, team: true } });
    });
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, dto: UpdateInventoryCountPlanDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plan = await this.prisma.inventoryCountPlan.findFirst({ where: { id, tenantId, organizationId }, include: { scopes: { where: { active: true } } } });
    if (!plan) throw new NotFoundAppError('InventoryCountPlan', id);
    if (plan.status !== 'DRAFT') {
      if (dto.scope) throw new CountScopeImmutableError();
      throw new ValidationAppError('Only a DRAFT inventory count plan can be edited; cancel/reopen the session to revise it.');
    }
    this.validatePolicies(dto);
    if (dto.scope?.length) await this.scopes.validateRules(tenantId, organizationId, dto.scope);

    return this.prisma.runInTransaction(async (tx) => {
      const result = await tx.inventoryCountPlan.updateMany({
        where: { id, tenantId, version: dto.expectedVersion },
        data: {
          ...this.policyData(dto),
          ...(dto.countType ? { countType: dto.countType } : {}),
          ...(dto.planDate ? { planDate: this.parseDate(dto.planDate) } : {}),
          ...(dto.plannedStartAt ? { plannedStartAt: new Date(dto.plannedStartAt) } : {}),
          ...(dto.plannedEndAt ? { plannedEndAt: new Date(dto.plannedEndAt) } : {}),
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      if (dto.scope) {
        const revision = await this.scopes.replaceRules(tenantId, id, dto.scope, userId, tx);
        await this.events.audit(
          tenantId,
          {
            eventType: 'INVENTORY_COUNT_SCOPE_CHANGED',
            entityType: INVENTORY_COUNT_PLAN_TYPE,
            entityId: id,
            action: 'UPDATE',
            userId,
            oldValues: { scope: plan.scopes.map((s) => ({ ruleType: s.ruleType, dimension: s.dimension, valueId: s.valueId })) },
            newValues: { scope: dto.scope, revision },
            reason: dto.scopeChangeReason,
          },
          tx,
        );
      }
      if (dto.team) await this.replaceTeam(tenantId, id, dto.team, userId, tx);
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_PLAN_UPDATED', entityType: INVENTORY_COUNT_PLAN_TYPE, entityId: id, action: 'UPDATE', userId, newValues: this.policyData(dto) }, tx);
      return tx.inventoryCountPlan.findFirst({ where: { id }, include: { scopes: { where: { active: true } }, team: true } });
    });
  }

  /** "Preview Scope" (spec section 108): the live in-scope stock lines. */
  async previewScope(tenantId: string, membershipId: string, organizationId: string, id: string, canSeeQuantities: boolean) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plan = await this.prisma.inventoryCountPlan.findFirst({ where: { id, tenantId, organizationId } });
    if (!plan) throw new NotFoundAppError('InventoryCountPlan', id);
    const scope = await this.scopes.resolve(tenantId, organizationId, id);
    const rows = (await this.snapshots.getInventoryBalance(tenantId, organizationId, scope, new Date())).filter((r) => !r.quantity.isZero());
    return {
      scope: scope.toJSON(),
      lineCount: rows.length,
      warehouseCount: new Set(rows.map((r) => r.warehouseId)).size,
      productCount: new Set(rows.map((r) => r.productId)).size,
      totalQuantity: canSeeQuantities ? rows.reduce((s, r) => s.plus(r.quantity), new Decimal(0)).toString() : undefined,
      lines: rows.slice(0, 500).map((r) => ({ ...r, quantity: canSeeQuantities ? r.quantity.toString() : undefined })),
    };
  }

  private async replaceTeam(tenantId: string, planId: string, team: { userId: string; role: string }[], userId: string, tx: PrismaTransactionClient) {
    await tx.inventoryCountTeamMember.deleteMany({ where: { tenantId, planId } });
    for (const m of team) {
      await tx.inventoryCountTeamMember.upsert({
        where: { planId_userId_role: { planId, userId: m.userId, role: m.role } },
        create: { tenantId, planId, userId: m.userId, role: m.role, createdBy: userId },
        update: {},
      });
    }
  }

  private validatePolicies(dto: InventoryCountPlanFieldsDto) {
    if (dto.recountPolicy === 'RECOUNT_ABOVE_QUANTITY_THRESHOLD' && dto.recountQuantityThreshold == null) throw new ValidationAppError('recountQuantityThreshold is required for RECOUNT_ABOVE_QUANTITY_THRESHOLD');
    if (dto.recountPolicy === 'RECOUNT_ABOVE_VALUE_THRESHOLD' && dto.recountValueThreshold == null) throw new ValidationAppError('recountValueThreshold is required for RECOUNT_ABOVE_VALUE_THRESHOLD');
    if (dto.recountPolicy === 'RECOUNT_PERCENTAGE' && dto.recountPercentThreshold == null) throw new ValidationAppError('recountPercentThreshold is required for RECOUNT_PERCENTAGE');
  }

  private policyData(dto: InventoryCountPlanFieldsDto): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of POLICY_FIELDS) if ((dto as any)[f] !== undefined) out[f] = (dto as any)[f];
    for (const f of DECIMAL_FIELDS) if ((dto as any)[f] !== undefined) out[f] = (dto as any)[f] === null ? null : new Decimal((dto as any)[f]).toString();
    if (dto.approvalThresholds !== undefined) out.approvalThresholds = dto.approvalThresholds as any;
    return out;
  }

  private parseDate(value: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ValidationAppError('Invalid date');
    return d;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INVENTORY_COUNT_PLAN_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INVENTORY_COUNT_PLAN_TYPE, documentType: INVENTORY_COUNT_PLAN_TYPE, prefix: PLAN_SEQUENCE_PREFIX, padding: 3, resetPolicy: 'YEARLY' } });
    } catch {
      // lost the race — fine
    }
  }
}
