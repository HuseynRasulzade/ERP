import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEFAULT_TIME_CODES: { code: string; name: string; countsAsWorkedTime: boolean; countsAsPaidTime: boolean }[] = [
  { code: 'REGULAR_WORK', name: 'Regular Work', countsAsWorkedTime: true, countsAsPaidTime: true },
  { code: 'OVERTIME', name: 'Overtime', countsAsWorkedTime: true, countsAsPaidTime: true },
  { code: 'NIGHT_WORK', name: 'Night Work', countsAsWorkedTime: true, countsAsPaidTime: true },
  { code: 'WEEKEND_WORK', name: 'Weekend Work', countsAsWorkedTime: true, countsAsPaidTime: true },
  { code: 'HOLIDAY_WORK', name: 'Holiday Work', countsAsWorkedTime: true, countsAsPaidTime: true },
  { code: 'ANNUAL_LEAVE', name: 'Annual Leave', countsAsWorkedTime: false, countsAsPaidTime: true },
  { code: 'UNPAID_LEAVE', name: 'Unpaid Leave', countsAsWorkedTime: false, countsAsPaidTime: false },
  { code: 'SICK_LEAVE', name: 'Sick Leave', countsAsWorkedTime: false, countsAsPaidTime: true },
  { code: 'BUSINESS_TRIP', name: 'Business Trip', countsAsWorkedTime: true, countsAsPaidTime: true },
  { code: 'ABSENCE', name: 'Absence', countsAsWorkedTime: false, countsAsPaidTime: false },
  { code: 'TRAINING', name: 'Training', countsAsWorkedTime: true, countsAsPaidTime: true },
  { code: 'DOWNTIME', name: 'Downtime', countsAsWorkedTime: false, countsAsPaidTime: true },
  { code: 'OTHER', name: 'Other', countsAsWorkedTime: false, countsAsPaidTime: false },
];

/** TimeCodeService (spec sections 24-25) — a per-tenant configurable
 * catalog. `seedDefaults` gives a new tenant the spec's own minimum list
 * (never hardcoded elsewhere in the calculation services — they all
 * resolve behavior through this catalog's attributes). */
@Injectable()
export class TimeCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async seedDefaults(tenantId: string, userId: string) {
    const created = [];
    for (const c of DEFAULT_TIME_CODES) {
      const row = await this.prisma.timeCode.upsert({ where: { tenantId_code: { tenantId, code: c.code } }, create: { tenantId, ...c }, update: {} });
      created.push(row);
    }
    await this.audit.record({ tenantId, eventType: 'WT_TIME_CODES_SEEDED', entityType: 'TIME_CODE', entityId: tenantId, action: 'CREATE', userId, newValues: { count: created.length } });
    return created;
  }

  async create(tenantId: string, userId: string, dto: { code: string; name: string; countsAsWorkedTime?: boolean; countsAsPaidTime?: boolean; payrollCode?: string; requiresDocument?: boolean; overlapPriority?: number; affectsFte?: boolean; accountingCategory?: string }) {
    const row = await this.prisma.timeCode.create({ data: { tenantId, code: dto.code, name: dto.name, countsAsWorkedTime: dto.countsAsWorkedTime ?? true, countsAsPaidTime: dto.countsAsPaidTime ?? true, payrollCode: dto.payrollCode, requiresDocument: dto.requiresDocument ?? false, overlapPriority: dto.overlapPriority ?? 100, affectsFte: dto.affectsFte ?? false, accountingCategory: dto.accountingCategory } });
    await this.audit.record({ tenantId, eventType: 'WT_TIME_CODE_CREATED', entityType: 'TIME_CODE', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return row;
  }

  list(tenantId: string) {
    return this.prisma.timeCode.findMany({ where: { tenantId, active: true }, orderBy: { code: 'asc' } });
  }

  byCode(tenantId: string, code: string) {
    return this.prisma.timeCode.findUnique({ where: { tenantId_code: { tenantId, code } } });
  }
}
