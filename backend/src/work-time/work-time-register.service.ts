import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { TimeCodes } from './time-codes';

export const WORK_TIME_REGISTER = 'WORK_TIME_REGISTER';

const BASE_MOVEMENT_TYPES = [
  { field: 'regularHours', movementType: TimeCodes.REGULAR_WORK },
  { field: 'overtimeHours', movementType: TimeCodes.OVERTIME },
  { field: 'nightHours', movementType: TimeCodes.NIGHT_WORK },
  { field: 'holidayHours', movementType: TimeCodes.HOLIDAY_WORK },
  { field: 'weekendHours', movementType: TimeCodes.WEEKEND_WORK },
  { field: 'businessTripHours', movementType: TimeCodes.BUSINESS_TRIP },
] as const;

/**
 * WorkTimeRegisterService — the approved-layer Truth Engine (docx spec
 * Phase 18 sections 108-110), reusing the generic RegisterMovement ledger
 * (the fifth reuse of this codebase's Truth Engine principle after Stock/
 * Cash/Bank/FixedAsset). Movements are written once, when a Timesheet is
 * LOCKED — never from raw attendance directly (spec section 109: "Reports
 * və payroll input bu register-dan gəlməlidir. Raw attendance-dan yox.").
 *
 * REGULAR_WORK/OVERTIME are the base worked-hours movements; NIGHT_WORK/
 * HOLIDAY_WORK/WEEKEND_WORK are written as separate premium-overlay
 * movements from the exact same underlying hours — `getWorkedHours()`
 * only sums the base movements, so a premium hour is never double-counted
 * in a "total worked" query (spec sections 47-48).
 */
@Injectable()
export class WorkTimeRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async writeFromTimesheet(
    tenantId: string,
    timesheetId: string,
    tx: PrismaTransactionClient,
  ) {
    const lines = await tx.timesheetLine.findMany({ where: { timesheetId } });
    for (const line of lines) {
      for (const { field, movementType } of BASE_MOVEMENT_TYPES) {
        const hours = new Decimal((line[field] as Decimal).toString());
        if (hours.lte(0)) continue;
        await this.writeMovement(tenantId, tx, {
          recorderDocumentId: timesheetId,
          recorderLineId: line.id,
          businessDate: line.workDate,
          employmentId: line.employmentId,
          organizationId: (await tx.timesheet.findUnique({
            where: { id: timesheetId },
          }))!.organizationId,
          departmentId: line.departmentId,
          movementType,
          hours,
        });
      }

      const leaveAbsenceEntries = await tx.timeEntry.findMany({
        where: {
          tenantId,
          employmentId: line.employmentId,
          workDate: line.workDate,
          status: 'ACTIVE',
          source: { in: ['LEAVE', 'ABSENCE'] },
        },
      });
      const timesheet = await tx.timesheet.findUnique({
        where: { id: timesheetId },
      });
      const byCode = new Map<string, Decimal>();
      for (const e of leaveAbsenceEntries) {
        const prior = byCode.get(e.timeCode) ?? new Decimal(0);
        byCode.set(e.timeCode, prior.plus(e.hours.toString()));
      }
      for (const [timeCode, hours] of byCode) {
        if (hours.lte(0)) continue;
        await this.writeMovement(tenantId, tx, {
          recorderDocumentId: timesheetId,
          recorderLineId: line.id,
          businessDate: line.workDate,
          employmentId: line.employmentId,
          organizationId: timesheet!.organizationId,
          departmentId: line.departmentId,
          movementType: timeCode,
          hours,
        });
      }
    }
  }

  private async writeMovement(
    tenantId: string,
    tx: PrismaTransactionClient,
    params: {
      recorderDocumentId: string;
      recorderLineId: string;
      businessDate: Date;
      employmentId: string;
      organizationId: string;
      departmentId: string | null;
      movementType: string;
      hours: Decimal;
    },
  ) {
    const sequence = await tx.registerMovement.count({
      where: {
        tenantId,
        registerCode: WORK_TIME_REGISTER,
        recorderDocumentType: 'WORK_TIME_TIMESHEET',
        recorderDocumentId: params.recorderDocumentId,
      },
    });
    await tx.registerMovement.create({
      data: {
        tenantId,
        registerCode: WORK_TIME_REGISTER,
        recorderDocumentType: 'WORK_TIME_TIMESHEET',
        recorderDocumentId: params.recorderDocumentId,
        recorderLineId: params.recorderLineId,
        businessDate: params.businessDate,
        sequence: BigInt(sequence + 1),
        movementType: params.movementType,
        dimensions: {
          employmentId: params.employmentId,
          organizationId: params.organizationId,
          departmentId: params.departmentId,
        },
        resources: { hours: params.hours.toString() },
      },
    });
  }

  /** Sums hours for one or more movement types (time codes) over a date
   * range — the read side every internal API method below is built on. */
  async getHours(
    tenantId: string,
    employmentId: string,
    fromDate: Date,
    toDate: Date,
    movementTypes: string[],
  ): Promise<Decimal> {
    const movements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: WORK_TIME_REGISTER,
        businessDate: { gte: fromDate, lte: toDate },
        movementType: { in: movementTypes },
        dimensions: { path: ['employmentId'], equals: employmentId },
      },
    });
    return movements.reduce((sum, m) => {
      const resources = m.resources as { hours?: string } | null;
      return sum.plus(resources?.hours ?? '0');
    }, new Decimal(0));
  }
}
