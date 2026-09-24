import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateInventoryCountPlanDto } from './dto/inventory-count-plan.dto';

const PLAN_TYPE = 'INVENTORY_COUNT_PLAN';
const SEQUENCE_PREFIX = 'IC';

/**
 * InventoryCountPlanService (spec section 4) — scope and rules defined
 * BEFORE a session ever starts. A plan is not itself posted anywhere; it
 * is the reusable configuration `InventoryCountSessionService.start`
 * reads from.
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
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.inventoryCountPlan.findMany({ where: { tenantId, organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.inventoryCountPlan.findFirst({ where: { id, tenantId, organizationId }, include: { scopes: true, sessions: true } });
    if (!row) throw new NotFoundAppError('InventoryCountPlan', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateInventoryCountPlanDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const planDate = this.parseDate(dto.planDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PLAN_TYPE, planDate, tx);

      const plan = await tx.inventoryCountPlan.create({
        data: {
          tenantId,
          organizationId,
          branchId: dto.branchId,
          number: allocated.formatted,
          planDate,
          plannedStartAt: dto.plannedStartAt ? new Date(dto.plannedStartAt) : undefined,
          plannedEndAt: dto.plannedEndAt ? new Date(dto.plannedEndAt) : undefined,
          countType: dto.countType ?? 'FULL',
          reason: dto.reason,
          responsibleUserId: dto.responsibleUserId,
          countManagerId: dto.countManagerId,
          blindCountEnabled: dto.blindCountEnabled ?? true,
          freezePolicy: dto.freezePolicy ?? 'NO_FREEZE_WITH_MOVEMENT_TRACKING',
          cutoffMode: dto.cutoffMode ?? 'GLOBAL_SNAPSHOT_CUTOFF',
          recountPolicy: dto.recountPolicy ?? 'RECOUNT_ABOVE_VALUE_THRESHOLD',
          recountQuantityThreshold: dto.recountQuantityThreshold?.toString(),
          recountValueThreshold: dto.recountValueThreshold?.toString(),
          recountPercentageThreshold: dto.recountPercentageThreshold?.toString(),
          maxRecountAttempts: dto.maxRecountAttempts ?? 2,
          varianceQuantityTolerance: dto.varianceQuantityTolerance?.toString(),
          varianceValueTolerance: dto.varianceValueTolerance?.toString(),
          variancePercentageTolerance: dto.variancePercentageTolerance?.toString(),
          surplusCostPolicy: dto.surplusCostPolicy ?? 'CURRENT_AVERAGE',
          comment: dto.comment,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [i, scope] of (dto.scopes ?? []).entries()) {
        await tx.inventoryCountScope.create({
          data: {
            tenantId,
            inventoryCountPlanId: plan.id,
            includeExclude: scope.includeExclude ?? 'INCLUDE',
            warehouseId: scope.warehouseId,
            locationId: scope.locationId,
            locationSubtree: scope.locationSubtree ?? false,
            productId: scope.productId,
            productGroupId: scope.productGroupId,
            batchId: scope.batchId,
            serialId: scope.serialId,
            ownershipType: scope.ownershipType,
            qualityStatus: scope.qualityStatus,
          },
        });
        void i;
      }

      await this.audit.record(
        { tenantId, eventType: 'INVENTORY_COUNT_PLAN_CREATED', entityType: PLAN_TYPE, entityId: plan.id, action: 'CREATE', userId, newValues: { number: plan.number, countType: plan.countType, scopeCount: dto.scopes?.length ?? 0 } },
        tx,
      );

      return tx.inventoryCountPlan.findFirst({ where: { id: plan.id }, include: { scopes: true } });
    });
  }

  async markReady(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      const plan = await tx.inventoryCountPlan.findFirst({ where: { id, tenantId, organizationId }, include: { scopes: true } });
      if (!plan) throw new NotFoundAppError('InventoryCountPlan', id);
      if (plan.version !== expectedVersion) throw new ValidationAppError('Stale plan version');
      if (plan.status !== 'DRAFT') throw new ValidationAppError('Only a DRAFT plan can be marked READY');
      if (plan.scopes.length === 0) throw new ValidationAppError('Count session cannot start because no inventory scope has been defined');

      const updated = await tx.inventoryCountPlan.update({ where: { id }, data: { status: 'READY', updatedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_PLAN_READY', entityType: PLAN_TYPE, entityId: id, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
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
