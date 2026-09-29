import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine, AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { RunPrepaidRecognitionDto } from './dto/expenses.dto';
import { EXPENSE_MOVEMENT_REGISTER } from './expense-movement-register.service';

export const PREPAID_RECOGNITION_RUN_TYPE = 'PREPAID_RECOGNITION_RUN';

/**
 * PrepaidRecognitionRunService (docx spec Phase 20 sections 41, 118) —
 * Phase 22 Month Close is expected to call this. Idempotent NOT via a
 * per-run duplicate guard (each call creates its own new run row) but
 * because the query that selects work is `PrepaidExpenseSchedule.status
 * = 'PLANNED'`: a period already recognized by a prior run has nothing
 * left to select, so retrying produces an empty, harmless second run
 * (spec test 192).
 */
@Injectable()
export class PrepaidRecognitionRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly accountingEngine: AccountingPostingEngine,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.prepaidRecognitionRun.findMany({ where: { organizationId }, orderBy: { startedAt: 'desc' } });
  }

  async run(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: RunPrepaidRecognitionDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = new Date(Date.UTC(dto.periodYear, dto.periodMonth, 0));

    const scheduleRows = await this.prisma.prepaidExpenseSchedule.findMany({
      where: {
        tenantId,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        status: 'PLANNED',
        prepaid: { organizationId, status: 'ACTIVE' },
      },
      include: { prepaid: true },
    });

    const run = await this.prisma.prepaidRecognitionRun.create({
      data: { tenantId, organizationId, periodYear: dto.periodYear, periodMonth: dto.periodMonth, status: 'RUNNING' },
    });

    if (scheduleRows.length === 0) {
      const completed = await this.prisma.prepaidRecognitionRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', itemsProcessed: 0, totalAmount: 0, completedAt: new Date() },
      });
      return completed;
    }

    const categories = await this.prisma.expenseCategory.findMany({
      where: { tenantId, id: { in: Array.from(new Set(scheduleRows.map((s) => s.prepaid.expenseCategoryId))) } },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const result = await this.prisma.runInTransaction(async (tx) => {
      const prepaidAssetAccount = await this.mappings.resolve(tenantId, organizationId, 'PREPAID_EXPENSE_ASSET', businessDate, tx);
      const lines: AccountingPostingLineInput[] = [];
      let total = new Decimal(0);

      for (const schedule of scheduleRows) {
        const category = categoryById.get(schedule.prepaid.expenseCategoryId);
        const expenseMappingKey = category?.defaultAccountingMappingKey ?? 'ADMIN_EXPENSE';
        const expenseAccount = await this.mappings.resolve(tenantId, organizationId, expenseMappingKey, businessDate, tx);
        const amount = new Decimal(schedule.plannedRecognitionAmount.toString());
        const dims: AccountingPostingLineInput['dimensions'] = [];
        if (schedule.prepaid.costCenterId) dims.push({ dimensionCode: 'COST_CENTER', referenceId: schedule.prepaid.costCenterId });
        if (schedule.prepaid.projectId) dims.push({ dimensionCode: 'PROJECT', referenceId: schedule.prepaid.projectId });

        lines.push({
          accountId: expenseAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: `Prepaid recognition ${dto.periodYear}-${String(dto.periodMonth).padStart(2, '0')} — ${category?.name ?? schedule.prepaid.expenseCategoryId}`,
          dimensions: dims,
        });
        lines.push({
          accountId: prepaidAssetAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: `Prepaid recognition ${dto.periodYear}-${String(dto.periodMonth).padStart(2, '0')}`,
          dimensions: dims,
        });
        total = total.plus(amount);

        await tx.prepaidExpenseSchedule.update({ where: { id: schedule.id }, data: { status: 'RECOGNIZED', recognizedAmount: amount } });
        const newRecognized = new Decimal(schedule.prepaid.recognizedAmount.toString()).plus(amount);
        const newRemaining = Decimal.max(0, new Decimal(schedule.prepaid.originalAmount.toString()).minus(newRecognized));
        await tx.prepaidExpense.update({
          where: { id: schedule.prepaidExpenseId },
          data: {
            recognizedAmount: newRecognized,
            remainingAmount: newRemaining,
            status: newRemaining.lte(0) ? 'FULLY_RECOGNIZED' : 'ACTIVE',
          },
        });

        const sequence = await tx.registerMovement.count({
          where: { tenantId, registerCode: EXPENSE_MOVEMENT_REGISTER, recorderDocumentType: PREPAID_RECOGNITION_RUN_TYPE, recorderDocumentId: run.id },
        });
        await tx.registerMovement.create({
          data: {
            tenantId,
            registerCode: EXPENSE_MOVEMENT_REGISTER,
            recorderDocumentType: PREPAID_RECOGNITION_RUN_TYPE,
            recorderDocumentId: run.id,
            recorderLineId: schedule.id,
            businessDate,
            sequence: BigInt(sequence + 1),
            movementType: 'PREPAID_RECOGNIZE',
            dimensions: { organizationId, expenseCategoryId: schedule.prepaid.expenseCategoryId, costCenterId: schedule.prepaid.costCenterId, projectId: schedule.prepaid.projectId },
            resources: { expenseAmount: amount.toString(), prepaidAmount: amount.negated().toString() },
          },
        });
      }

      await this.accountingEngine.postBatch(
        tenantId,
        userId,
        {
          organizationId,
          businessDate,
          postingDate: businessDate,
          description: `Prepaid recognition ${dto.periodYear}-${String(dto.periodMonth).padStart(2, '0')}`,
          operationType: 'SYSTEM_DOCUMENT',
          sourceDocumentType: PREPAID_RECOGNITION_RUN_TYPE,
          sourceDocumentId: run.id,
          lines,
        },
        tx,
      );

      return tx.prepaidRecognitionRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', itemsProcessed: scheduleRows.length, totalAmount: total, completedAt: new Date() },
      });
    });

    await this.audit.record({
      tenantId,
      eventType: 'PREPAID_EXPENSE_RECOGNIZED',
      entityType: PREPAID_RECOGNITION_RUN_TYPE,
      entityId: result.id,
      action: 'UPDATE',
      userId,
      newValues: { itemsProcessed: result.itemsProcessed, totalAmount: result.totalAmount.toString() },
    });
    return result;
  }
}
