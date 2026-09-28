import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CreateTaxProfileDto } from './dto/payroll.dto';

/**
 * PayrollTaxProfileService — EmployeeTaxProfile, effective-dated (docx
 * spec Phase 19 section 48). Sensitive; permission-controlled at the
 * controller layer (PAYROLL_VIEW_TAX/PAYROLL_EDIT_TAX_PROFILE).
 */
@Injectable()
export class PayrollTaxProfileService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, employmentId: string) {
    return this.prisma.payrollTaxProfile.findMany({
      where: { tenantId, employmentId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateTaxProfileDto) {
    const effectiveFrom = this.parseDate(dto.effectiveFrom);
    return this.prisma.runInTransaction(async (tx) => {
      const prior = await tx.payrollTaxProfile.findFirst({
        where: { employmentId: dto.employmentId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (prior) {
        const dayBefore = new Date(effectiveFrom);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        await tx.payrollTaxProfile.update({ where: { id: prior.id }, data: { effectiveTo: dayBefore } });
      }
      return tx.payrollTaxProfile.create({
        data: {
          tenantId,
          employmentId: dto.employmentId,
          taxResidency: dto.taxResidency,
          mainWorkplace: dto.mainWorkplace ?? true,
          sectorCategory: dto.sectorCategory,
          exemptionCodes: dto.exemptionCodes,
          taxRegime: dto.taxRegime,
          effectiveFrom,
          createdBy: userId,
        },
      });
    });
  }

  /** The tax profile effective as of `asOfDate` — falls back to sensible
   * defaults (RESIDENT/main workplace/no exemptions) if none exists, so
   * the calculation engine never blocks on a missing profile. */
  async resolve(tenantId: string, employmentId: string, asOfDate: Date) {
    const profile = await this.prisma.payrollTaxProfile.findFirst({
      where: {
        tenantId,
        employmentId,
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return (
      profile ?? {
        taxResidency: 'RESIDENT',
        mainWorkplace: true,
        sectorCategory: 'PRIVATE_NONOIL',
        exemptionCodes: [] as string[],
        taxRegime: 'STANDARD',
      }
    );
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
