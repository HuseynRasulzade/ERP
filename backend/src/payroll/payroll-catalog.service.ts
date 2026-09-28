import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { CreateDeductionDefinitionDto, CreateEarningDefinitionDto } from './dto/payroll.dto';
import { DEFAULT_DEDUCTION_DEFINITIONS, DEFAULT_EARNING_DEFINITIONS } from './payroll-codes';

/**
 * PayrollCatalogService — PayrollEarningDefinition / PayrollDeductionDefinition
 * (docx spec Phase 19 sections 13-16), the configurable catalog the
 * calculation engine resolves against instead of a hardcoded switch.
 * `seedDefaults()` loads the standard set (see payroll-codes.ts) for a new
 * tenant — idempotent, safe to call more than once.
 */
@Injectable()
export class PayrollCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listEarnings(tenantId: string) {
    return this.prisma.payrollEarningDefinition.findMany({ where: { tenantId }, orderBy: { priority: 'asc' } });
  }

  async getEarning(tenantId: string, code: string) {
    const row = await this.prisma.payrollEarningDefinition.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!row) throw new NotFoundAppError('PayrollEarningDefinition', code);
    return row;
  }

  createEarning(tenantId: string, dto: CreateEarningDefinitionDto) {
    return this.prisma.payrollEarningDefinition.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        calculationStrategy: dto.calculationStrategy,
        taxableIncome: dto.taxableIncome ?? true,
        socialInsuranceBase: dto.socialInsuranceBase ?? true,
        unemploymentBase: dto.unemploymentBase ?? true,
        medicalInsuranceBase: dto.medicalInsuranceBase ?? true,
        averageEarningsInclusion: dto.averageEarningsInclusion ?? true,
        grossPayInclusion: dto.grossPayInclusion ?? true,
        employerCostInclusion: dto.employerCostInclusion ?? true,
        accountingMappingKey: dto.accountingMappingKey,
        priority: dto.priority ?? 100,
      },
    });
  }

  listDeductions(tenantId: string) {
    return this.prisma.payrollDeductionDefinition.findMany({ where: { tenantId }, orderBy: { priority: 'asc' } });
  }

  async getDeduction(tenantId: string, code: string) {
    const row = await this.prisma.payrollDeductionDefinition.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!row) throw new NotFoundAppError('PayrollDeductionDefinition', code);
    return row;
  }

  createDeduction(tenantId: string, dto: CreateDeductionDefinitionDto) {
    return this.prisma.payrollDeductionDefinition.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        category: dto.category,
        taxTreatment: dto.taxTreatment,
        calculationMethod: dto.calculationMethod,
        baseDefinition: dto.baseDefinition,
        percentage: dto.percentage,
        fixedAmount: dto.fixedAmount,
        capAmount: dto.capAmount,
        floorAmount: dto.floorAmount,
        priority: dto.priority ?? 100,
        consentRequired: dto.consentRequired ?? false,
        accountingMappingKey: dto.accountingMappingKey,
      },
    });
  }

  async seedDefaults(tenantId: string) {
    for (const e of DEFAULT_EARNING_DEFINITIONS) {
      await this.prisma.payrollEarningDefinition.upsert({
        where: { tenantId_code: { tenantId, code: e.code } },
        create: { tenantId, ...e },
        update: {},
      });
    }
    for (const d of DEFAULT_DEDUCTION_DEFINITIONS) {
      await this.prisma.payrollDeductionDefinition.upsert({
        where: { tenantId_code: { tenantId, code: d.code } },
        create: { tenantId, ...d },
        update: {},
      });
    }
    return { earnings: DEFAULT_EARNING_DEFINITIONS.length, deductions: DEFAULT_DEDUCTION_DEFINITIONS.length };
  }
}
