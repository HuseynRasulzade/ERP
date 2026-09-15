import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * AuditInvestigationService (docx spec Phase 25, sections 64-69). An
 * investigation is a curated bundle of references (audit events,
 * documents, movements, users, sessions, evidence) plus a reconstructed
 * chronological timeline (spec section 67-68) — timeline ordering uses
 * each linked audit event's own `timestamp`, falling back to `createdAt`
 * for non-audit-event items, both server-side/trusted (spec section 87).
 */
@Injectable()
export class AuditInvestigationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async open(tenantId: string, userId: string, dto: { title: string; description?: string; category?: string; severity?: string; assignedTo?: string }) {
    const investigation = await this.prisma.auditInvestigation.create({ data: { tenantId, title: dto.title, description: dto.description, category: dto.category, severity: dto.severity ?? 'MEDIUM', openedBy: userId, assignedTo: dto.assignedTo, status: 'OPEN' } });
    await this.audit.record({ tenantId, eventType: 'AUDIT_INVESTIGATION_OPENED', eventCategory: 'SECURITY', entityType: 'AuditInvestigation', entityId: investigation.id, action: 'CREATE', userId, newValues: { title: dto.title } });
    return investigation;
  }

  async addItem(tenantId: string, userId: string, investigationId: string, dto: { itemType: string; auditEventId?: string; referenceType?: string; referenceId?: string; note?: string }) {
    await this.getInvestigation(tenantId, investigationId);
    return this.prisma.auditInvestigationItem.create({ data: { tenantId, investigationId, itemType: dto.itemType, auditEventId: dto.auditEventId, referenceType: dto.referenceType, referenceId: dto.referenceId, note: dto.note, addedBy: userId } });
  }

  async setStatus(tenantId: string, userId: string, investigationId: string, status: string, conclusion?: string) {
    const investigation = await this.getInvestigation(tenantId, investigationId);
    const updated = await this.prisma.auditInvestigation.update({ where: { id: investigation.id }, data: { status, conclusion, closedAt: status === 'CLOSED' ? new Date() : undefined } });
    await this.audit.record({ tenantId, eventType: 'AUDIT_INVESTIGATION_STATUS_CHANGED', eventCategory: 'SECURITY', entityType: 'AuditInvestigation', entityId: investigation.id, action: 'UPDATE', userId, newValues: { status } });
    return updated;
  }

  /** Chronological reconstruction across every linked item (spec
   * section 67's own end-to-end example: role elevated -> bank changed
   * -> payment request changed -> approved -> payment created -> sent). */
  async timeline(tenantId: string, investigationId: string) {
    const investigation = await this.getInvestigation(tenantId, investigationId);
    const items = await this.prisma.auditInvestigationItem.findMany({ where: { tenantId, investigationId: investigation.id }, include: { auditEvent: true } });
    const rows = items.map((item) => ({
      itemId: item.id,
      itemType: item.itemType,
      timestamp: item.auditEvent?.timestamp ?? item.createdAt,
      description: item.auditEvent ? `${item.auditEvent.eventType} on ${item.auditEvent.entityType}/${item.auditEvent.entityId}` : `${item.referenceType ?? item.itemType} ${item.referenceId ?? ''}`.trim(),
      note: item.note,
    }));
    return rows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private async getInvestigation(tenantId: string, id: string) {
    const investigation = await this.prisma.auditInvestigation.findFirst({ where: { id, tenantId } });
    if (!investigation) throw new NotFoundAppError('AuditInvestigation', id);
    return investigation;
  }
}
