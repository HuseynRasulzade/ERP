import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { CreateExpenseCategoryDto } from './dto/expenses.dto';
import { DEFAULT_EXPENSE_CATEGORIES } from './expense-codes';

/**
 * ExpenseCategoryService (docx spec Phase 20 sections 7-8) — the
 * configurable catalog the policy/classification/tax engines resolve
 * against instead of a hardcoded switch. `seedDefaults()` loads the
 * standard set (see expense-codes.ts) for a new tenant — idempotent.
 */
@Injectable()
export class ExpenseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.expenseCategory.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.expenseCategory.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('ExpenseCategory', id);
    return row;
  }

  async getByCode(tenantId: string, code: string) {
    const row = await this.prisma.expenseCategory.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (!row) throw new NotFoundAppError('ExpenseCategory', code);
    return row;
  }

  create(tenantId: string, dto: CreateExpenseCategoryDto) {
    return this.prisma.expenseCategory.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        defaultAccountingMappingKey: dto.defaultAccountingMappingKey,
        receiptRequirement: dto.receiptRequirement ?? 'OPTIONAL',
        receiptRequiredThreshold: dto.receiptRequiredThreshold,
        businessPurposeRequired: dto.businessPurposeRequired ?? false,
        prepaidEligible: dto.prepaidEligible ?? false,
        capitalizableEligible: dto.capitalizableEligible ?? false,
        inventoryCostEligible: dto.inventoryCostEligible ?? false,
        allocationRequired: dto.allocationRequired ?? false,
      },
    });
  }

  async seedDefaults(tenantId: string) {
    for (const c of DEFAULT_EXPENSE_CATEGORIES) {
      await this.prisma.expenseCategory.upsert({
        where: { tenantId_code: { tenantId, code: c.code } },
        create: { tenantId, ...c },
        update: {},
      });
    }
    return { categories: DEFAULT_EXPENSE_CATEGORIES.length };
  }
}
