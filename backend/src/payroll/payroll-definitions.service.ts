import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEFAULT_EARNINGS: { code: string; name: string; calculationStrategy: string; averageEarningsInclusion?: boolean; taxableIncome?: boolean }[] = [
  { code: 'BASE_SALARY', name: 'Base Salary', calculationStrategy: 'MONTHLY_SALARY' },
  { code: 'HOURLY_PAY', name: 'Hourly Pay', calculationStrategy: 'HOURLY' },
  { code: 'OVERTIME_PAY', name: 'Overtime Pay', calculationStrategy: 'OVERTIME' },
  { code: 'NIGHT_PREMIUM', name: 'Night Premium', calculationStrategy: 'NIGHT_PREMIUM' },
  { code: 'HOLIDAY_PREMIUM', name: 'Holiday Premium', calculationStrategy: 'HOLIDAY_PREMIUM' },
  { code: 'WEEKEND_PREMIUM', name: 'Weekend Premium', calculationStrategy: 'HOLIDAY_PREMIUM' },
  { code: 'BONUS', name: 'Bonus', calculationStrategy: 'BONUS' },
  { code: 'COMMISSION', name: 'Commission', calculationStrategy: 'BONUS' },
  { code: 'ALLOWANCE', name: 'Allowance', calculationStrategy: 'MANUAL' },
  { code: 'LEAVE_PAY', name: 'Leave Pay', calculationStrategy: 'LEAVE_AVERAGE_PAY' },
  { code: 'SICK_PAY', name: 'Sick Pay', calculationStrategy: 'LEAVE_AVERAGE_PAY' },
  { code: 'BUSINESS_TRIP_PAY', name: 'Business Trip Pay', calculationStrategy: 'MANUAL' },
  { code: 'DOWNTIME_PAY', name: 'Downtime Pay', calculationStrategy: 'MANUAL' },
  { code: 'SEVERANCE', name: 'Severance', calculationStrategy: 'MANUAL', averageEarningsInclusion: false },
  { code: 'UNUSED_LEAVE_COMPENSATION', name: 'Unused Leave Compensation', calculationStrategy: 'LEAVE_AVERAGE_PAY', averageEarningsInclusion: false },
  { code: 'OTHER', name: 'Other Earning', calculationStrategy: 'MANUAL' },
];

const DEFAULT_DEDUCTIONS: { code: string; name: string; isStatutory: boolean; calculationOrder: number; calculationMethod: string }[] = [
  { code: 'INCOME_TAX', name: 'Income Tax', isStatutory: true, calculationOrder: 10, calculationMethod: 'BRACKET' },
  { code: 'EMPLOYEE_SOCIAL_INSURANCE', name: 'Employee Social Insurance', isStatutory: true, calculationOrder: 20, calculationMethod: 'BRACKET' },
  { code: 'EMPLOYEE_UNEMPLOYMENT_INSURANCE', name: 'Employee Unemployment Insurance', isStatutory: true, calculationOrder: 30, calculationMethod: 'BRACKET' },
  { code: 'EMPLOYEE_MEDICAL_INSURANCE', name: 'Employee Medical Insurance', isStatutory: true, calculationOrder: 40, calculationMethod: 'BRACKET' },
  { code: 'ALIMONY', name: 'Alimony', isStatutory: true, calculationOrder: 50, calculationMethod: 'FORMULA' },
  { code: 'EXECUTION_ORDER', name: 'Execution Order', isStatutory: true, calculationOrder: 55, calculationMethod: 'FORMULA' },
  { code: 'UNION_DUES', name: 'Union Dues', isStatutory: false, calculationOrder: 60, calculationMethod: 'PERCENTAGE' },
  { code: 'EMPLOYEE_LOAN', name: 'Employee Loan Recovery', isStatutory: false, calculationOrder: 70, calculationMethod: 'FIXED' },
  { code: 'EMPLOYEE_ADVANCE_RECOVERY', name: 'Employee Advance Recovery', isStatutory: false, calculationOrder: 71, calculationMethod: 'FIXED' },
  { code: 'DAMAGE_RECOVERY', name: 'Damage Recovery', isStatutory: false, calculationOrder: 72, calculationMethod: 'FIXED' },
  { code: 'VOLUNTARY_DEDUCTION', name: 'Voluntary Deduction', isStatutory: false, calculationOrder: 80, calculationMethod: 'FIXED' },
  { code: 'OTHER', name: 'Other Deduction', isStatutory: false, calculationOrder: 90, calculationMethod: 'FIXED' },
];

/** PayrollEarningDefinitionService + PayrollDeductionDefinitionService
 * combined (spec sections 13-16). Every calculation service resolves
 * behavior (taxable? social base? average-pay included?) through these
 * catalogs — never a hardcoded switch on the earning/deduction code. */
@Injectable()
export class PayrollDefinitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async seedDefaults(tenantId: string, userId: string) {
    for (const e of DEFAULT_EARNINGS) await this.prisma.payrollEarningDefinition.upsert({ where: { tenantId_code: { tenantId, code: e.code } }, create: { tenantId, ...e }, update: {} });
    for (const d of DEFAULT_DEDUCTIONS) await this.prisma.payrollDeductionDefinition.upsert({ where: { tenantId_code: { tenantId, code: d.code } }, create: { tenantId, ...d }, update: {} });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_DEFINITIONS_SEEDED', entityType: 'PAYROLL_EARNING_DEFINITION', entityId: tenantId, action: 'CREATE', userId, newValues: { earnings: DEFAULT_EARNINGS.length, deductions: DEFAULT_DEDUCTIONS.length } });
    return { earnings: DEFAULT_EARNINGS.length, deductions: DEFAULT_DEDUCTIONS.length };
  }

  earning(tenantId: string, code: string) {
    return this.prisma.payrollEarningDefinition.findUnique({ where: { tenantId_code: { tenantId, code } } });
  }

  deduction(tenantId: string, code: string) {
    return this.prisma.payrollDeductionDefinition.findUnique({ where: { tenantId_code: { tenantId, code } } });
  }

  listEarnings(tenantId: string) {
    return this.prisma.payrollEarningDefinition.findMany({ where: { tenantId, active: true }, orderBy: { priority: 'asc' } });
  }

  listDeductions(tenantId: string) {
    return this.prisma.payrollDeductionDefinition.findMany({ where: { tenantId, active: true }, orderBy: { calculationOrder: 'asc' } });
  }

  async createEarning(tenantId: string, userId: string, dto: { code: string; name: string; calculationStrategy?: string; taxableIncome?: boolean; socialInsuranceBase?: boolean; unemploymentBase?: boolean; medicalInsuranceBase?: boolean; averageEarningsInclusion?: boolean; benefitPayer?: string; defaultMultiplier?: number; priority?: number }) {
    const row = await this.prisma.payrollEarningDefinition.create({ data: { tenantId, code: dto.code, name: dto.name, calculationStrategy: dto.calculationStrategy ?? 'MANUAL', taxableIncome: dto.taxableIncome ?? true, socialInsuranceBase: dto.socialInsuranceBase ?? true, unemploymentBase: dto.unemploymentBase ?? true, medicalInsuranceBase: dto.medicalInsuranceBase ?? true, averageEarningsInclusion: dto.averageEarningsInclusion ?? true, benefitPayer: dto.benefitPayer ?? 'EMPLOYER', defaultMultiplier: dto.defaultMultiplier?.toString(), priority: dto.priority ?? 100 } });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_EARNING_DEFINITION_CREATED', entityType: 'PAYROLL_EARNING_DEFINITION', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async createDeduction(tenantId: string, userId: string, dto: { code: string; name: string; isStatutory?: boolean; preTax?: boolean; calculationOrder?: number; calculationMethod?: string; percentage?: number; fixedAmount?: number; capAmount?: number; floorAmount?: number; consentRequired?: boolean }) {
    const row = await this.prisma.payrollDeductionDefinition.create({ data: { tenantId, code: dto.code, name: dto.name, isStatutory: dto.isStatutory ?? false, preTax: dto.preTax ?? false, calculationOrder: dto.calculationOrder ?? 100, calculationMethod: dto.calculationMethod ?? 'FIXED', percentage: dto.percentage?.toString(), fixedAmount: dto.fixedAmount?.toString(), capAmount: dto.capAmount?.toString(), floorAmount: dto.floorAmount?.toString(), consentRequired: dto.consentRequired ?? false } });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_DEDUCTION_DEFINITION_CREATED', entityType: 'PAYROLL_DEDUCTION_DEFINITION', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }
}
