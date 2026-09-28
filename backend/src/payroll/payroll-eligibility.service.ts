import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PayrollEligibilityService (docx spec Phase 19 section 8) — an employment
 * is eligible for a period if its active window overlaps the period at
 * all: active throughout, hired mid-period, or terminated mid-period all
 * fall out of the same overlap check against Phase 17's own
 * `employmentStartDate`/`employmentEndDate` fields, so hire/termination
 * dates never need special-cased handling here.
 */
@Injectable()
export class PayrollEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getEligibleEmployments(organizationId: string, periodStart: Date, periodEnd: Date) {
    return this.prisma.employment.findMany({
      where: {
        organizationId,
        employmentStartDate: { lte: periodEnd },
        OR: [{ employmentEndDate: null }, { employmentEndDate: { gte: periodStart } }],
        status: { in: ['ACTIVE', 'SUSPENDED', 'ON_LEAVE', 'TERMINATED'] },
      },
    });
  }

  async isEligible(employmentId: string, periodStart: Date, periodEnd: Date): Promise<boolean> {
    const employment = await this.prisma.employment.findFirst({ where: { id: employmentId } });
    if (!employment) return false;
    if (employment.employmentStartDate > periodEnd) return false;
    if (employment.employmentEndDate && employment.employmentEndDate < periodStart) return false;
    return ['ACTIVE', 'SUSPENDED', 'ON_LEAVE', 'TERMINATED'].includes(employment.status);
  }
}
