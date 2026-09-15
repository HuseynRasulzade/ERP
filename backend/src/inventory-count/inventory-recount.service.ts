import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateRecountDto, CompleteRecountDto } from './dto/inventory-count.dto';

/**
 * InventoryRecountService (spec sections 37-41, 123). A recount is a
 * fresh counting act, tracked entirely separately from
 * `InventoryCountEntry`'s own versioning chain — the ORIGINAL count
 * (spec test 123: "Original count remains in history") is never touched,
 * and multiple recounts accumulate rather than overwrite each other.
 * `InventoryVarianceResolutionService` decides the FINAL physical
 * quantity from among them (spec section 41) — this service only records
 * recount acts.
 */
@Injectable()
export class InventoryRecountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async request(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string, dto: CreateRecountDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);

    const priorCount = dto.varianceId ? await this.prisma.inventoryRecount.count({ where: { tenantId, sessionId, varianceId: dto.varianceId } }) : 0;

    return this.prisma.runInTransaction(async (tx) => {
      const recount = await tx.inventoryRecount.create({
        data: { tenantId, sessionId, varianceId: dto.varianceId, originalEntryId: dto.originalEntryId, recountNumber: priorCount + 1, assignedUserId: dto.assignedUserId, reason: dto.reason, resultStatus: 'PENDING' },
      });
      if (dto.varianceId) {
        await tx.inventoryVariance.update({ where: { id: dto.varianceId }, data: { resolutionStatus: 'RECOUNT_REQUIRED' } });
      }
      await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'RECOUNT_REQUIRED' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_RECOUNT_REQUESTED', entityType: 'INVENTORY_RECOUNT', entityId: recount.id, action: 'CREATE', userId, newValues: { recountNumber: recount.recountNumber } }, tx);
      return recount;
    });
  }

  async complete(tenantId: string, membershipId: string, organizationId: string, recountId: string, userId: string, dto: CompleteRecountDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const recount = await this.prisma.inventoryRecount.findFirst({ where: { id: recountId, tenantId } });
    if (!recount) throw new NotFoundAppError('InventoryRecount', recountId);

    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.inventoryRecount.update({ where: { id: recountId }, data: { physicalQuantity: new Decimal(dto.physicalQuantity).toString(), completedAt: new Date(), resultStatus: 'COMPLETED' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_RECOUNT_COMPLETED', entityType: 'INVENTORY_RECOUNT', entityId: recountId, action: 'UPDATE', userId, newValues: { physicalQuantity: dto.physicalQuantity } }, tx);
      return updated;
    });
  }

  /** Final physical quantity selection (spec section 41) — defaults to
   * the LATEST completed recount; a supervisor override happens through
   * `InventoryVarianceResolutionService.decide`'s own `finalPhysicalQty`
   * instead of here. */
  async latestForVariance(tenantId: string, varianceId: string): Promise<Decimal | null> {
    const recounts = await this.prisma.inventoryRecount.findMany({ where: { tenantId, varianceId, resultStatus: { in: ['COMPLETED', 'CONFIRMED'] } }, orderBy: { recountNumber: 'desc' }, take: 1 });
    if (recounts.length === 0 || recounts[0].physicalQuantity == null) return null;
    return new Decimal(recounts[0].physicalQuantity.toString());
  }
}
