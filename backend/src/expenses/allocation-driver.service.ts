import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * AllocationDriverService (spec sections 57-63). `sourceType` documents
 * where a driver's values SHOULD come from (`HR_HEADCOUNT`/`HR_FTE` from
 * Phase 17, `WORK_TIME_HOURS` from Phase 18) but this build only stores
 * whatever value is written via `setValue` — it does not itself pull
 * live headcount/FTE/worked-hours numbers from those modules (disclosed
 * simplification, see docs/EXPENSES.md); a caller resolves the number
 * and writes it here.
 */
@Injectable()
export class AllocationDriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { code: string; name: string; sourceType?: string }) {
    const row = await this.prisma.allocationDriver.create({ data: { tenantId, code: dto.code, name: dto.name, sourceType: dto.sourceType ?? 'MANUAL' } });
    await this.audit.record({ tenantId, eventType: 'ALLOCATION_DRIVER_CREATED', entityType: 'ALLOCATION_DRIVER', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async setValue(tenantId: string, userId: string, dto: { driverId: string; period: string; costCenterId: string; value: number; source?: string }) {
    const driver = await this.prisma.allocationDriver.findFirst({ where: { id: dto.driverId, tenantId } });
    if (!driver) throw new NotFoundAppError('AllocationDriver', dto.driverId);
    const period = new Date(dto.period);
    const row = await this.prisma.allocationDriverValue.upsert({
      where: { driverId_period_costCenterId: { driverId: dto.driverId, period, costCenterId: dto.costCenterId } },
      create: { tenantId, driverId: dto.driverId, period, costCenterId: dto.costCenterId, value: dto.value.toString(), source: dto.source ?? 'MANUAL', createdBy: userId },
      update: { value: dto.value.toString(), source: dto.source ?? 'MANUAL' },
    });
    await this.audit.record({ tenantId, eventType: 'ALLOCATION_DRIVER_VALUE_SET', entityType: 'ALLOCATION_DRIVER_VALUE', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  valuesForPeriod(tenantId: string, driverId: string, period: Date) {
    return this.prisma.allocationDriverValue.findMany({ where: { tenantId, driverId, period, status: 'ACTIVE' } });
  }

  list(tenantId: string) {
    return this.prisma.allocationDriver.findMany({ where: { tenantId, active: true } });
  }
}
