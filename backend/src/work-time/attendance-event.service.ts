import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAttendanceEventDto } from './dto/work-time.dto';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * AttendanceEvent — raw, immutable (docx spec Phase 18 sections 18-19).
 * Idempotent on (sourceSystem, externalEventId) per spec section 104/102:
 * re-importing the same external event returns the existing row instead of
 * creating a duplicate. Manual/API entries with no external id are always
 * distinct rows (Postgres treats NULL as never equal to NULL in the
 * unique index, so they never collide with each other).
 */
@Injectable()
export class AttendanceEventService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    tenantId: string,
    employmentId: string,
    fromDate: string,
    toDate: string,
  ) {
    return this.prisma.attendanceEvent.findMany({
      where: {
        tenantId,
        employmentId,
        eventTimestamp: {
          gte: this.parseDate(fromDate),
          lt: this.addDays(this.parseDate(toDate), 1),
        },
      },
      orderBy: { eventTimestamp: 'asc' },
    });
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateAttendanceEventDto,
  ) {
    if (dto.sourceSystem && dto.externalEventId) {
      const existing = await this.prisma.attendanceEvent.findUnique({
        where: {
          sourceSystem_externalEventId: {
            sourceSystem: dto.sourceSystem,
            externalEventId: dto.externalEventId,
          },
        },
      });
      if (existing) return existing;
    }
    return this.prisma.attendanceEvent.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        eventTimestamp: this.parseDateTime(dto.eventTimestamp),
        eventType: dto.eventType,
        location: dto.location,
        deviceId: dto.deviceId,
        externalEventId: dto.externalEventId,
        sourceSystem: dto.sourceSystem,
        createdBy: userId,
      },
    });
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }

  private parseDateTime(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid timestamp');
    return date;
  }
}
