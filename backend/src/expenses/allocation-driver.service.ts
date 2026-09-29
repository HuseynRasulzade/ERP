import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { SetAllocationDriverValueDto, ComputeDriverValuesDto } from './dto/expenses.dto';
import { DEFAULT_ALLOCATION_DRIVERS, AllocationDriverCodes } from './expense-codes';

const WORK_TIME_REGISTER = 'WORK_TIME_REGISTER';

/**
 * AllocationDriverService (docx spec Phase 20 sections 57-63) — a
 * tenant-configurable catalog (same convention as PayrollEarningDefinition/
 * AllocationDriver being a real table, not a hardcoded enum).
 * `computeHeadcount`/`computeFte`/`computeWorkedHours` populate
 * `AllocationDriverValue` FROM Phase 17 (employment headcount/FTE) and
 * Phase 18 (`WORK_TIME_REGISTER`) directly — never duplicating those
 * registers, only reading them (spec sections 59, 61: "Phase 17 as-of-
 * period headcount source istifadə edilə bilər" / "Use Phase 18
 * WorkTimeRegister").
 */
@Injectable()
export class AllocationDriverService {
  constructor(private readonly prisma: PrismaService) {}

  async seedDefaults(tenantId: string) {
    for (const d of DEFAULT_ALLOCATION_DRIVERS) {
      await this.prisma.allocationDriver.upsert({
        where: { tenantId_code: { tenantId, code: d.code } },
        create: { tenantId, ...d },
        update: {},
      });
    }
    return { drivers: DEFAULT_ALLOCATION_DRIVERS.length };
  }

  list(tenantId: string) {
    return this.prisma.allocationDriver.findMany({ where: { tenantId } });
  }

  async getByCode(tenantId: string, code: string) {
    const row = await this.prisma.allocationDriver.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (!row) throw new NotFoundAppError('AllocationDriver', code);
    return row;
  }

  async getValues(tenantId: string, allocationDriverId: string, periodYear: number, periodMonth: number) {
    return this.prisma.allocationDriverValue.findMany({
      where: { tenantId, allocationDriverId, periodYear, periodMonth, status: 'ACTIVE' },
    });
  }

  async setValue(tenantId: string, dto: SetAllocationDriverValueDto) {
    return this.prisma.allocationDriverValue.upsert({
      where: {
        allocationDriverId_periodYear_periodMonth_targetType_targetId: {
          allocationDriverId: dto.allocationDriverId,
          periodYear: dto.periodYear,
          periodMonth: dto.periodMonth,
          targetType: dto.targetType,
          targetId: dto.targetId,
        },
      },
      create: {
        tenantId,
        allocationDriverId: dto.allocationDriverId,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        targetType: dto.targetType,
        targetId: dto.targetId,
        value: dto.value,
        source: 'MANUAL',
      },
      update: { value: dto.value, source: 'MANUAL' },
    });
  }

  /** Headcount (spec section 59) — active employments per department,
   * read from Employment's own cached department/status projection
   * (disclosed simplification: a snapshot, not a full as-of-period
   * historical reconstruction — same convention as this build's other
   * "department resolved once" simplifications). */
  async computeHeadcount(tenantId: string, organizationId: string, dto: ComputeDriverValuesDto) {
    const driver = await this.getByCode(tenantId, AllocationDriverCodes.HEADCOUNT);
    const rows = await this.prisma.employment.groupBy({
      by: ['departmentId'],
      where: { tenantId, organizationId, status: 'ACTIVE', departmentId: { in: dto.targetDepartmentIds } },
      _count: { _all: true },
    });
    return this.persistComputed(tenantId, driver.id, dto, rows.map((r) => ({ targetId: r.departmentId, value: new Decimal(r._count._all) })), 'PHASE17_HEADCOUNT');
  }

  async computeFte(tenantId: string, organizationId: string, dto: ComputeDriverValuesDto) {
    const driver = await this.getByCode(tenantId, AllocationDriverCodes.FTE);
    const rows = await this.prisma.employment.groupBy({
      by: ['departmentId'],
      where: { tenantId, organizationId, status: 'ACTIVE', departmentId: { in: dto.targetDepartmentIds } },
      _sum: { fte: true },
    });
    return this.persistComputed(
      tenantId,
      driver.id,
      dto,
      rows.map((r) => ({ targetId: r.departmentId, value: new Decimal(r._sum.fte?.toString() ?? '0') })),
      'PHASE17_FTE',
    );
  }

  /** Worked hours (spec section 61) — sums Phase 18's own
   * `WORK_TIME_REGISTER` REGULAR_WORK+OVERTIME movements by department,
   * read directly (never re-derived from raw attendance). */
  async computeWorkedHours(tenantId: string, dto: ComputeDriverValuesDto) {
    const driver = await this.getByCode(tenantId, AllocationDriverCodes.WORKED_HOURS);
    const periodStart = new Date(Date.UTC(dto.periodYear, dto.periodMonth - 1, 1));
    const periodEnd = new Date(Date.UTC(dto.periodYear, dto.periodMonth, 0));
    const movements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: WORK_TIME_REGISTER,
        movementType: { in: ['REGULAR_WORK', 'OVERTIME'] },
        businessDate: { gte: periodStart, lte: periodEnd },
      },
    });
    const byDepartment = new Map<string, Decimal>();
    for (const m of movements) {
      const dims = m.dimensions as { departmentId?: string | null } | null;
      const departmentId = dims?.departmentId;
      if (!departmentId || !dto.targetDepartmentIds.includes(departmentId)) continue;
      const resources = m.resources as { hours?: string } | null;
      const hours = new Decimal(resources?.hours ?? '0');
      byDepartment.set(departmentId, (byDepartment.get(departmentId) ?? new Decimal(0)).plus(hours));
    }
    return this.persistComputed(
      tenantId,
      driver.id,
      dto,
      Array.from(byDepartment.entries()).map(([targetId, value]) => ({ targetId, value })),
      'PHASE18_WORKED_HOURS',
    );
  }

  private async persistComputed(
    tenantId: string,
    allocationDriverId: string,
    dto: ComputeDriverValuesDto,
    values: Array<{ targetId: string; value: Decimal }>,
    source: string,
  ) {
    for (const v of values) {
      await this.prisma.allocationDriverValue.upsert({
        where: {
          allocationDriverId_periodYear_periodMonth_targetType_targetId: {
            allocationDriverId,
            periodYear: dto.periodYear,
            periodMonth: dto.periodMonth,
            targetType: 'DEPARTMENT',
            targetId: v.targetId,
          },
        },
        create: {
          tenantId,
          allocationDriverId,
          periodYear: dto.periodYear,
          periodMonth: dto.periodMonth,
          targetType: 'DEPARTMENT',
          targetId: v.targetId,
          value: v.value,
          source,
        },
        update: { value: v.value, source },
      });
    }
    return this.getValues(tenantId, allocationDriverId, dto.periodYear, dto.periodMonth);
  }
}
