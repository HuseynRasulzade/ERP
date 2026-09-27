import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountSessionInvalidStateError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { RequestInventoryRecountDto, SubmitInventoryRecountDto } from './dto/inventory-variance.dto';

const EPSILON = new Decimal('0.000001');

/**
 * InventoryRecountService (spec sections 37-41) — a recount is its OWN
 * row, never an overwrite of the original physical count (spec section
 * 38: "Recount əvvəlki quantity-ni overwrite etməməlidir"). Final
 * quantity selection here is the simplest of the spec's own listed
 * options (section 41) — "latest recount" — a disclosed choice; a
 * supervisor-confirmed/consensus variant is not built.
 */
@Injectable()
export class InventoryRecountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryRecount.findMany({ where: { tenantId, sessionId }, orderBy: { createdAt: 'asc' } });
  }

  async request(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, varianceId: string, dto: RequestInventoryRecountDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId }, include: { plan: true } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (!['RECOUNT_REQUIRED', 'UNDER_REVIEW', 'PENDING_APPROVAL'].includes(session.status)) {
        throw new CountSessionInvalidStateError('A recount can only be requested while the session is under review');
      }

      const variance = await tx.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId } });
      if (!variance) throw new NotFoundAppError('InventoryVariance', varianceId);

      const priorAttempts = await tx.inventoryRecount.count({ where: { tenantId, sessionId, varianceId } });
      if (priorAttempts >= session.plan.maxRecountAttempts) {
        throw new ValidationAppError(`Maximum recount attempts (${session.plan.maxRecountAttempts}) already reached for this variance`);
      }

      const recount = await tx.inventoryRecount.create({
        data: { tenantId, sessionId, varianceId, recountNumber: priorAttempts + 1, assignedUserId: dto.assignedUserId, startedAt: new Date(), reason: dto.reason },
      });
      await tx.inventoryVariance.update({ where: { id: varianceId }, data: { resolutionStatus: 'RECOUNT_REQUIRED', recountRequired: true, recountCount: { increment: 1 } } });
      if (session.status !== 'RECOUNT_REQUIRED') {
        await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'RECOUNT_REQUIRED', version: { increment: 1 } } });
      }
      await this.audit.record({ tenantId, eventType: 'INVENTORY_RECOUNT_REQUESTED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: 'CREATE', userId, newValues: { recountId: recount.id, recountNumber: recount.recountNumber } }, tx);
      return recount;
    });
  }

  async submit(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, recountId: string, dto: SubmitInventoryRecountDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const recount = await tx.inventoryRecount.findFirst({ where: { id: recountId, tenantId, sessionId } });
      if (!recount) throw new NotFoundAppError('InventoryRecount', recountId);
      if (recount.resultStatus === 'COMPLETED') throw new ValidationAppError('This recount has already been completed');

      const physicalQuantity = new Decimal(dto.physicalQuantity);
      const updatedRecount = await tx.inventoryRecount.update({
        where: { id: recountId },
        data: { physicalQuantity: physicalQuantity.toString(), completedAt: new Date(), countedBy: dto.countedBy ?? userId, resultStatus: 'COMPLETED' },
      });

      // Final physical quantity selection (spec section 41): latest
      // completed recount wins — the original count and every prior
      // recount attempt stay in InventoryRecount history untouched.
      const variance = await tx.inventoryVariance.findFirst({ where: { id: recount.varianceId ?? undefined, tenantId } });
      if (variance) {
        const adjusted = new Decimal(variance.adjustedAccountingQuantity.toString());
        const newDiff = physicalQuantity.minus(adjusted);
        const unitCost = variance.unitCost ? new Decimal(variance.unitCost.toString()) : null;
        const newValueDiff = unitCost ? newDiff.times(unitCost).toDecimalPlaces(2) : null;
        const varianceType = newDiff.abs().lte(EPSILON) ? 'MATCH' : newDiff.gt(0) ? 'SURPLUS' : 'SHORTAGE';

        const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId }, include: { plan: true } });
        const stillNeedsRecount = this.needsRecount(newDiff, newValueDiff, adjusted, session!.plan);
        const attempts = await tx.inventoryRecount.count({ where: { tenantId, sessionId, varianceId: variance.id, resultStatus: 'COMPLETED' } });
        const exhausted = attempts >= session!.plan.maxRecountAttempts;

        await tx.inventoryVariance.update({
          where: { id: variance.id },
          data: {
            physicalQuantity: physicalQuantity.toString(),
            quantityDifference: newDiff.toString(),
            valueDifference: newValueDiff ? newValueDiff.toString() : null,
            varianceType: variance.varianceType === 'LOCATION_MISMATCH' || variance.varianceType === 'BATCH_MISMATCH' ? variance.varianceType : varianceType,
            recountRequired: stillNeedsRecount && !exhausted,
            resolutionStatus: stillNeedsRecount && !exhausted ? 'RECOUNT_REQUIRED' : 'OPEN',
          },
        });

        const remainingRecountNeeded = await tx.inventoryVariance.count({ where: { tenantId, sessionId, resolutionStatus: 'RECOUNT_REQUIRED' } });
        if (remainingRecountNeeded === 0) {
          await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'PENDING_APPROVAL', version: { increment: 1 } } });
        }
      }

      await this.audit.record({ tenantId, eventType: 'INVENTORY_RECOUNT_COMPLETED', entityType: 'INVENTORY_RECOUNT', entityId: recountId, action: 'UPDATE', userId, newValues: { physicalQuantity: physicalQuantity.toString() } }, tx);
      return updatedRecount;
    });
  }

  private needsRecount(diff: Decimal, valueDiff: Decimal | null, adjustedQty: Decimal, plan: { recountPolicy: string; recountQuantityThreshold: Decimal | null; recountValueThreshold: Decimal | null; recountPercentageThreshold: Decimal | null }): boolean {
    switch (plan.recountPolicy) {
      case 'NO_RECOUNT':
      case 'NEVER_RECOUNT':
      case 'MANUAL_SELECTION':
        return false;
      case 'RECOUNT_ALL_VARIANCES':
      case 'ALWAYS_RECOUNT':
        return diff.abs().gt(EPSILON);
      case 'RECOUNT_ABOVE_QUANTITY_THRESHOLD':
        return plan.recountQuantityThreshold ? diff.abs().gt(new Decimal(plan.recountQuantityThreshold.toString())) : false;
      case 'RECOUNT_ABOVE_VALUE_THRESHOLD':
        return plan.recountValueThreshold && valueDiff ? valueDiff.abs().gt(new Decimal(plan.recountValueThreshold.toString())) : false;
      case 'RECOUNT_PERCENTAGE':
      case 'RECOUNT_ABOVE_PERCENTAGE_THRESHOLD':
        if (!plan.recountPercentageThreshold || adjustedQty.abs().lte(0)) return false;
        return diff.abs().div(adjustedQty.abs()).times(100).gt(new Decimal(plan.recountPercentageThreshold.toString()));
      default:
        return false;
    }
  }
}
