import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { ReclassifyExpenseLineDto } from './dto/expenses.dto';
import { EXPENSE_MOVEMENT_REGISTER } from './expense-movement-register.service';

const ADJUSTMENT_TYPE = 'EXPENSE_ADJUSTMENT';

/**
 * ExpenseAdjustmentService (docx spec Phase 20 sections 106-114) — the
 * only sanctioned way to change a posted claim line's cost-center
 * assignment. Reclassification nets to zero on total company expense
 * (spec section 107: A -1,000 / B +1,000) — implemented as a small
 * standalone GL entry (Dr new CC / Cr old CC, same account) plus a
 * `COST_ALLOCATION_OUT`/`COST_ALLOCATION_IN` pair on the Expense
 * Movement Register, rather than unposting/reposting the original claim
 * (disclosed simplification — full dependency-safe reversal of the
 * original document is out of scope; see docs/EXPENSES.md). Only
 * RECLASSIFY_COST_CENTER is implemented end-to-end; other adjustment
 * types are recorded for audit/traceability but have no automated GL
 * effect in this build.
 */
@Injectable()
export class ExpenseAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly accountingEngine: AccountingPostingEngine,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.expenseAdjustment.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  async reclassifyCostCenter(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: ReclassifyExpenseLineDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.expenseClaimLine.findFirst({
      where: { id: dto.claimLineId, tenantId, claim: { organizationId } },
      include: { claim: true },
    });
    if (!line) throw new NotFoundAppError('ExpenseClaimLine', dto.claimLineId);
    if (line.claim.postingStatus !== 'POSTED')
      throw new ValidationAppError('Cannot reclassify a line whose claim was never posted — edit the draft claim instead');
    if (!line.costCenterId) throw new ValidationAppError('This line has no cost center to reclassify from');
    if (line.costCenterId === dto.newCostCenterId)
      throw new ValidationAppError('newCostCenterId is the same as the current cost center');
    const amount = new Decimal(line.approvedAmount?.toString() ?? '0');
    if (amount.lte(0)) throw new ValidationAppError('This line has no approved amount to reclassify');

    const businessDate = line.claim.postingDate ?? line.claim.documentDate;
    const oldCostCenterId = line.costCenterId;

    const result = await this.prisma.runInTransaction(async (tx) => {
      const account = await this.mappings.resolve(tenantId, organizationId, 'ADMIN_EXPENSE', businessDate, tx);
      const adjustment = await tx.expenseAdjustment.create({
        data: {
          tenantId,
          organizationId,
          adjustmentType: 'RECLASSIFY_COST_CENTER',
          sourceClaimLineId: line.id,
          fromValue: { costCenterId: oldCostCenterId },
          toValue: { costCenterId: dto.newCostCenterId },
          amount,
          reason: dto.reason,
          status: 'POSTED',
          postedAt: new Date(),
          createdBy: userId,
        },
      });

      await this.accountingEngine.postBatch(
        tenantId,
        userId,
        {
          organizationId,
          businessDate,
          postingDate: businessDate,
          description: `Expense reclassification — ${dto.reason}`,
          operationType: 'SYSTEM_DOCUMENT',
          sourceDocumentType: ADJUSTMENT_TYPE,
          sourceDocumentId: adjustment.id,
          lines: [
            {
              accountId: account.id,
              side: 'DEBIT',
              amountBase: amount,
              description: `Reclassify line ${line.id} into cost center ${dto.newCostCenterId}`,
              dimensions: [{ dimensionCode: 'COST_CENTER', referenceId: dto.newCostCenterId }],
            },
            {
              accountId: account.id,
              side: 'CREDIT',
              amountBase: amount,
              description: `Reclassify line ${line.id} out of cost center ${oldCostCenterId}`,
              dimensions: [{ dimensionCode: 'COST_CENTER', referenceId: oldCostCenterId }],
            },
          ],
        },
        tx,
      );

      await tx.registerMovement.createMany({
        data: [
          {
            tenantId,
            registerCode: EXPENSE_MOVEMENT_REGISTER,
            recorderDocumentType: ADJUSTMENT_TYPE,
            recorderDocumentId: adjustment.id,
            recorderLineId: line.id,
            businessDate,
            sequence: 1n,
            movementType: 'COST_ALLOCATION_OUT',
            dimensions: { organizationId, costCenterId: oldCostCenterId },
            resources: { expenseAmount: amount.negated().toString() },
          },
          {
            tenantId,
            registerCode: EXPENSE_MOVEMENT_REGISTER,
            recorderDocumentType: ADJUSTMENT_TYPE,
            recorderDocumentId: adjustment.id,
            recorderLineId: line.id,
            businessDate,
            sequence: 2n,
            movementType: 'COST_ALLOCATION_IN',
            dimensions: { organizationId, costCenterId: dto.newCostCenterId },
            resources: { expenseAmount: amount.toString() },
          },
        ],
      });

      await tx.expenseClaimLine.update({ where: { id: line.id }, data: { costCenterId: dto.newCostCenterId } });
      return adjustment;
    });

    await this.audit.record({
      tenantId,
      eventType: 'EXPENSE_RECLASSIFIED',
      entityType: ADJUSTMENT_TYPE,
      entityId: result.id,
      action: 'UPDATE',
      userId,
      oldValues: { costCenterId: oldCostCenterId },
      newValues: { costCenterId: dto.newCostCenterId },
      reason: dto.reason,
    });
    return result;
  }
}
