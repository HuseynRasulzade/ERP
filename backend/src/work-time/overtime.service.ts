import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/** OvertimeService (spec sections 37-41). `approve` is the ONLY thing
 * that makes `TimeEntryService.generateFromAttendance` classify any
 * excess hours as OVERTIME (spec section 38 — actual > plan is never
 * automatic overtime). Daily/weekly/period threshold policies (spec
 * section 41) are a future extension point — this build only supports
 * per-date manual approval (`MANUAL_ONLY`/`POST_APPROVAL_ALLOWED`,
 * disclosed simplification, see docs/WORK_TIME.md). */
@Injectable()
export class OvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async request(tenantId: string, userId: string, dto: { employmentId: string; date: string; requestedHours: number; reason?: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const row = await this.prisma.overtimeRecord.create({ data: { tenantId, employmentId: dto.employmentId, date: new Date(dto.date), requestedHours: dto.requestedHours.toString(), reason: dto.reason, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'WT_OVERTIME_REQUESTED', entityType: 'OVERTIME_RECORD', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async approve(tenantId: string, userId: string, id: string, approvedHours: number) {
    const record = await this.prisma.overtimeRecord.findFirst({ where: { id, tenantId } });
    if (!record) throw new NotFoundAppError('OvertimeRecord', id);
    if (record.status === 'APPROVED') throw new ValidationAppError('Overtime record is already approved — approving twice would double it (spec section 103)');
    const row = await this.prisma.overtimeRecord.update({ where: { id }, data: { status: 'APPROVED', approvedHours: approvedHours.toString(), approvedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'WT_OVERTIME_APPROVED', entityType: 'OVERTIME_RECORD', entityId: id, action: 'UPDATE', userId, newValues: { approvedHours } });
    return row;
  }

  async reject(tenantId: string, userId: string, id: string, reason?: string) {
    const record = await this.prisma.overtimeRecord.findFirst({ where: { id, tenantId } });
    if (!record) throw new NotFoundAppError('OvertimeRecord', id);
    const row = await this.prisma.overtimeRecord.update({ where: { id }, data: { status: 'REJECTED', reason: reason ?? record.reason } });
    await this.audit.record({ tenantId, eventType: 'WT_OVERTIME_REJECTED', entityType: 'OVERTIME_RECORD', entityId: id, action: 'UPDATE', userId, newValues: { reason } });
    return row;
  }

  list(tenantId: string, employmentId?: string, status?: string) {
    return this.prisma.overtimeRecord.findMany({ where: { tenantId, employmentId, status }, orderBy: { date: 'desc' } });
  }
}
