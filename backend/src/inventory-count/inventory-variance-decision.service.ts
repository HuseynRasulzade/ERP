import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountSessionInvalidStateError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { DecideVarianceDto } from './dto/inventory-variance.dto';

/**
 * InventoryVarianceResolutionService (spec sections 48-50) — records HOW a
 * variance will be resolved (`InventoryVarianceDecision`) and gates it
 * behind a separate approval step before `InventoryCountAdjustmentService`
 * is ever allowed to turn it into a real posting. A variance still
 * `RECOUNT_REQUIRED` cannot be decided (spec section 114's own error
 * wording is enforced one step later, at post time, but deciding before a
 * pending recount finishes would already be premature).
 */
@Injectable()
export class InventoryVarianceResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async decide(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, varianceId: string, dto: DecideVarianceDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const variance = await tx.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId }, include: { decision: true } });
      if (!variance) throw new NotFoundAppError('InventoryVariance', varianceId);
      if (variance.resolutionStatus === 'RECOUNT_REQUIRED') throw new CountSessionInvalidStateError('This variance still has a pending recount — resolve it before deciding');
      if (variance.resolutionStatus === 'POSTED') throw new ValidationAppError('This variance has already been posted');
      if (variance.decision?.status === 'APPROVED') throw new ValidationAppError('This variance decision has already been approved — it can no longer be edited');

      const finalPhysicalQuantity = dto.finalPhysicalQuantity != null ? new Decimal(dto.finalPhysicalQuantity) : (variance.physicalQuantity ? new Decimal(variance.physicalQuantity.toString()) : new Decimal(0));
      const acceptedDifference = finalPhysicalQuantity.minus(variance.adjustedAccountingQuantity.toString());

      const decision = await tx.inventoryVarianceDecision.upsert({
        where: { varianceId },
        create: {
          tenantId,
          varianceId,
          finalPhysicalQuantity: finalPhysicalQuantity.toString(),
          acceptedDifference: acceptedDifference.toString(),
          resolutionType: dto.resolutionType,
          reasonCode: dto.reasonCode,
          approvedCost: dto.approvedCost?.toString(),
          comment: dto.comment,
          status: 'PENDING',
        },
        update: {
          finalPhysicalQuantity: finalPhysicalQuantity.toString(),
          acceptedDifference: acceptedDifference.toString(),
          resolutionType: dto.resolutionType,
          reasonCode: dto.reasonCode,
          approvedCost: dto.approvedCost?.toString(),
          comment: dto.comment,
          status: 'PENDING',
        },
      });

      await tx.inventoryVariance.update({ where: { id: varianceId }, data: { resolutionStatus: 'UNDER_INVESTIGATION', reasonCode: dto.reasonCode ?? variance.reasonCode } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_DECIDED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: variance.decision ? 'UPDATE' : 'CREATE', userId, newValues: { resolutionType: dto.resolutionType, reasonCode: dto.reasonCode } }, tx);
      return decision;
    });
  }

  async approve(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, varianceId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const variance = await tx.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId }, include: { decision: true } });
      if (!variance) throw new NotFoundAppError('InventoryVariance', varianceId);
      if (!variance.decision) throw new ValidationAppError('This variance has no recorded decision to approve');
      if (variance.decision.status === 'APPROVED') return variance.decision;
      if (variance.decision.status === 'POSTED') throw new ValidationAppError('This variance decision has already been posted');

      const approved = await tx.inventoryVarianceDecision.update({ where: { varianceId }, data: { status: 'APPROVED', approver: userId, approvedAt: new Date() } });
      await tx.inventoryVariance.update({ where: { id: varianceId }, data: { resolutionStatus: 'APPROVED' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_APPROVED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: 'UPDATE', userId }, tx);

      const openCount = await tx.inventoryVariance.count({
        where: { tenantId, sessionId, resolutionStatus: { notIn: ['APPROVED', 'POSTED'] }, varianceType: { notIn: ['MATCH'] } },
      });
      if (openCount === 0) {
        await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'APPROVED', version: { increment: 1 } } });
      }
      return approved;
    });
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, varianceId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const variance = await this.prisma.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId }, include: { decision: true } });
    if (!variance?.decision) throw new NotFoundAppError('InventoryVarianceDecision', varianceId);

    const rejected = await this.prisma.inventoryVarianceDecision.update({ where: { varianceId }, data: { status: 'REJECTED', comment: comment ?? variance.decision.comment } });
    await this.prisma.inventoryVariance.update({ where: { id: varianceId }, data: { resolutionStatus: 'REJECTED' } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_REJECTED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: 'UPDATE', userId, newValues: { comment } });
    return rejected;
  }
}
