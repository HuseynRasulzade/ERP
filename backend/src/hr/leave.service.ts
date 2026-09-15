import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * LeaveService + AbsenceService combined (spec sections 38-40) — HR
 * foundation only. Full entitlement/balance calculation and worked-hours
 * integration are Phase 18's own scope (spec's own "Full leave/work time
 * Phase 18-də gələcək").
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async requestLeave(tenantId: string, userId: string, dto: { employmentId: string; leaveType: string; startDate: string; endDate: string; sourceDocumentType?: string; sourceDocumentId?: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) throw new ValidationAppError('endDate cannot be before startDate');

    const row = await this.prisma.leaveRecord.create({ data: { tenantId, employmentId: dto.employmentId, leaveType: dto.leaveType, startDate, endDate, sourceDocumentType: dto.sourceDocumentType, sourceDocumentId: dto.sourceDocumentId, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_LEAVE_REQUESTED', entityType: 'LEAVE_RECORD', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async approveLeave(tenantId: string, userId: string, id: string) {
    const leave = await this.prisma.leaveRecord.findFirst({ where: { id, tenantId, status: 'REQUESTED' } });
    if (!leave) throw new NotFoundAppError('LeaveRecord', id);
    const row = await this.prisma.leaveRecord.update({ where: { id }, data: { status: 'APPROVED', approvedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_LEAVE_APPROVED', entityType: 'LEAVE_RECORD', entityId: id, action: 'UPDATE', userId, newValues: {} });
    return row;
  }

  listLeaves(tenantId: string, employmentId: string) {
    return this.prisma.leaveRecord.findMany({ where: { tenantId, employmentId }, orderBy: { startDate: 'desc' } });
  }

  async recordAbsence(tenantId: string, userId: string, dto: { employmentId: string; absenceType: string; startDate: string; endDate: string; reason?: string; supportingDocumentAssetId?: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const row = await this.prisma.absenceRecord.create({ data: { tenantId, employmentId: dto.employmentId, absenceType: dto.absenceType, startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), reason: dto.reason, supportingDocumentAssetId: dto.supportingDocumentAssetId, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_ABSENCE_RECORDED', entityType: 'ABSENCE_RECORD', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  listAbsences(tenantId: string, employmentId: string) {
    return this.prisma.absenceRecord.findMany({ where: { tenantId, employmentId }, orderBy: { startDate: 'desc' } });
  }
}
