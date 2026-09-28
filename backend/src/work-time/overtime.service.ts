import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  ApproveOvertimeDto,
  CreateOvertimeRequestDto,
} from './dto/work-time.dto';

/**
 * OvertimeRecord (docx spec Phase 18 sections 37-41) — actual-minus-plan is
 * never automatically overtime (spec section 38). Only PREAPPROVAL_REQUIRED
 * is implemented (disclosed simplification: POST_APPROVAL_ALLOWED/
 * AUTO_WITH_THRESHOLD/MANUAL_ONLY policies and the daily/weekly/period
 * threshold configuration of spec sections 39/41 are not — every excess
 * hour needs an APPROVED OvertimeRecord for that exact date to be counted
 * as payroll-eligible overtime; TimesheetService flags the rest as an
 * exception instead of silently dropping or silently approving it).
 */
@Injectable()
export class OvertimeService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    tenantId: string,
    employmentId: string,
    fromDate: string,
    toDate: string,
  ) {
    return this.prisma.overtimeRecord.findMany({
      where: {
        tenantId,
        employmentId,
        date: { gte: this.parseDate(fromDate), lte: this.parseDate(toDate) },
      },
      orderBy: { date: 'asc' },
    });
  }

  async request(
    tenantId: string,
    userId: string,
    dto: CreateOvertimeRequestDto,
  ) {
    return this.prisma.overtimeRecord.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        date: this.parseDate(dto.date),
        requestedHours: new Decimal(dto.requestedHours),
        reason: dto.reason,
        createdBy: userId,
      },
    });
  }

  async approve(
    tenantId: string,
    userId: string,
    id: string,
    dto: ApproveOvertimeDto,
  ) {
    const record = await this.prisma.overtimeRecord.findFirst({
      where: { id, tenantId },
    });
    if (!record) throw new NotFoundAppError('OvertimeRecord', id);
    if (record.status !== 'REQUESTED')
      throw new ValidationAppError(
        `Cannot approve an overtime record in status ${record.status}`,
      );
    return this.prisma.overtimeRecord.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedHours: new Decimal(dto.approvedHours),
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
  }

  /** Approved overtime hours for one employment/date, or 0 if none. */
  async getApprovedHours(
    tenantId: string,
    employmentId: string,
    date: Date,
  ): Promise<Decimal> {
    const record = await this.prisma.overtimeRecord.findFirst({
      where: { tenantId, employmentId, date, status: 'APPROVED' },
    });
    return record?.approvedHours
      ? new Decimal(record.approvedHours.toString())
      : new Decimal(0);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
