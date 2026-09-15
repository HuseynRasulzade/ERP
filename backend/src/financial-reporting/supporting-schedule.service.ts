import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgeingService } from '../settlement/ageing.service';
import { InventoryValuationService } from '../inventory-costing/inventory-valuation.service';

/**
 * SupportingScheduleService (docx spec Phase 23, sections 121-123).
 * Reuses each owning module's own report (`AgeingService`,
 * `InventoryValuationService`) rather than recomputing them — the
 * schedules exist to RECONCILE with the main statement row, not to
 * become a second source of truth (spec section 131). Fixed
 * assets/prepaid/payroll/tax schedules read the same tables Phase 22's
 * own `CloseReconciliationService` already established as each
 * subledger's authoritative total.
 */
@Injectable()
export class SupportingScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ageing: AgeingService,
    private readonly inventoryValuation: InventoryValuationService,
  ) {}

  arAgeing(tenantId: string, organizationId: string, asOfDate: Date) {
    return this.ageing.customerAgeing(tenantId, organizationId, asOfDate);
  }

  apAgeing(tenantId: string, organizationId: string, asOfDate: Date) {
    return this.ageing.supplierAgeing(tenantId, organizationId, asOfDate);
  }

  inventoryValuationSchedule(tenantId: string, organizationId: string, asOfDate: Date) {
    return this.inventoryValuation.valuationAsOf(tenantId, asOfDate, { organizationId });
  }

  async fixedAssetSchedule(tenantId: string, organizationId: string) {
    const assets = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { notIn: ['DISPOSED', 'WRITTEN_OFF'] } }, select: { id: true, assetNumber: true, name: true, initialCost: true, accumulatedDepreciation: true, impairmentBalance: true, carryingAmount: true } });
    return assets;
  }

  async prepaidExpenseSchedule(tenantId: string, organizationId: string) {
    return this.prisma.prepaidExpense.findMany({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] } }, select: { id: true, expenseCategoryId: true, originalAmount: true, recognizedAmount: true, remainingAmount: true, recognitionEndDate: true } });
  }

  async payrollLiabilitySchedule(tenantId: string, organizationId: string) {
    return this.prisma.payrollLiability.groupBy({ by: ['liabilityType'], where: { tenantId, organizationId, status: { notIn: ['PAID', 'WRITTEN_OFF'] } }, _sum: { outstanding: true } });
  }

  async taxBalanceSchedule(tenantId: string, organizationId: string, closeRunId: string) {
    return this.prisma.taxPeriodCloseResult.findMany({ where: { tenantId, organizationId, closeRunId } });
  }

  async wipSchedule(tenantId: string, organizationId: string) {
    return this.prisma.productionOrder.findMany({
      where: { tenantId, organizationId, postingStatus: 'POSTED', closeStatus: { not: 'CLOSED' } },
      select: { id: true, number: true, plannedOutputQuantity: true },
    });
  }

  async equityRollforwardSchedule(tenantId: string) {
    return this.prisma.equityComponent.findMany({ where: { tenantId } });
  }
}
