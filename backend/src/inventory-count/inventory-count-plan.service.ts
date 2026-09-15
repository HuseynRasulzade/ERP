import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateInventoryCountPlanDto } from './dto/inventory-count.dto';

const SEQUENCE_PREFIX = 'IC';
const PLAN_TYPE = 'INVENTORY_COUNT_PLAN';

/**
 * InventoryCountPlanService (spec sections 4-6, 87). Not a
 * DocumentFramework document — a plan has no posting concept of its own
 * (nothing ever debits/credits an account); its own `status` lifecycle
 * (DRAFT -> READY -> ACTIVE -> COMPLETED/CANCELLED) is managed directly
 * here.
 */
@Injectable()
export class InventoryCountPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.inventoryCountPlan.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.inventoryCountPlan.findFirst({ where: { id, organizationId }, include: { scopes: true, sessions: true } });
    if (!row) throw new NotFoundAppError('InventoryCountPlan', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateInventoryCountPlanDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.ensureSequence(tenantId);
    const planDate = this.parseDate(dto.planDate);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PLAN_TYPE, planDate, tx);
      const plan = await tx.inventoryCountPlan.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          planDate,
          plannedStartAt: dto.plannedStartAt ? new Date(dto.plannedStartAt) : undefined,
          plannedEndAt: dto.plannedEndAt ? new Date(dto.plannedEndAt) : undefined,
          countType: dto.countType ?? 'FULL',
          reason: dto.reason,
          responsibleUserId: dto.responsibleUserId,
          countManagerId: dto.countManagerId,
          blindCountEnabled: dto.blindCountEnabled ?? false,
          freezePolicy: dto.freezePolicy ?? 'SOFT_FREEZE',
          recountPolicy: dto.recountPolicy ?? 'RECOUNT_ABOVE_VALUE_THRESHOLD',
          recountQuantityThreshold: dto.recountQuantityThreshold?.toString(),
          recountValueThreshold: dto.recountValueThreshold?.toString(),
          recountPercentageThreshold: dto.recountPercentageThreshold?.toString(),
          comment: dto.comment,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const scope of dto.scopes ?? []) {
        await tx.inventoryCountScope.create({ data: { tenantId, planId: plan.id, ...scope } });
      }

      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_PLAN_CREATED', entityType: PLAN_TYPE, entityId: plan.id, action: 'CREATE', userId, newValues: { number: plan.number, countType: plan.countType } }, tx);

      return tx.inventoryCountPlan.findFirst({ where: { id: plan.id }, include: { scopes: true } });
    });
  }

  /** Adds a scope row — blocked once the plan's first session has left
   * DRAFT (spec section 6: scope becomes controlled/immutable once
   * counting is under way). */
  async addScope(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, scope: Record<string, unknown>) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plan = await this.prisma.inventoryCountPlan.findFirst({ where: { id: planId, organizationId }, include: { sessions: true } });
    if (!plan) throw new NotFoundAppError('InventoryCountPlan', planId);
    if (plan.sessions.some((s) => s.status !== 'DRAFT' && s.status !== 'CANCELLED')) {
      throw new ValidationAppError('Cannot change scope: a session for this plan has already started counting — cancel/reopen it first (spec section 6)');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.inventoryCountScope.create({ data: { tenantId, planId, ...scope } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SCOPE_CHANGED', entityType: 'INVENTORY_COUNT_SCOPE', entityId: row.id, action: 'CREATE', userId, newValues: scope }, tx);
      return row;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid plan date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PLAN_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PLAN_TYPE, documentType: PLAN_TYPE, prefix: SEQUENCE_PREFIX, padding: 4, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
