import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_COUNT_SESSION_TYPE } from './inventory-count.constants';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryCountEventsService } from './inventory-count-events.service';
import { AddAttachmentDto } from './dto/inventory-count.dto';

/**
 * Attachments on a count session or a single variance (spec section 71):
 * photos, signed count sheets, incident reports, investigation documents,
 * employee explanations, scanned forms. Metadata + an opaque storage key;
 * the binary itself goes through whatever file store the tenant uses.
 */
@Injectable()
export class InventoryCountAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async add(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, dto: AddAttachmentDto) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    if (dto.varianceId) {
      const v = await this.prisma.inventoryVariance.findFirst({ where: { id: dto.varianceId, tenantId, sessionId: session.id } });
      if (!v) throw new ValidationAppError('Variance does not belong to this inventory count');
    }
    const row = await this.prisma.inventoryCountAttachment.create({ data: { tenantId, sessionId: session.id, varianceId: dto.varianceId, kind: dto.kind, fileName: dto.fileName, storageKey: dto.storageKey, description: dto.description, uploadedBy: userId } });
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_ATTACHMENT_ADDED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'ATTACH', userId, newValues: { attachmentId: row.id, kind: dto.kind, fileName: dto.fileName, varianceId: dto.varianceId ?? null } });
    return row;
  }

  async list(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    return this.prisma.inventoryCountAttachment.findMany({ where: { tenantId, sessionId: session.id }, orderBy: { uploadedAt: 'asc' } });
  }
}
