import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { InventoryCostingPolicyService } from './inventory-costing-policy.service';
import { InventoryCostingDimensionService } from './costing-dimension.service';
import { FIFOCostingStrategy } from './fifo-costing.strategy';
import { WeightedAverageCostingStrategy } from './weighted-average-costing.strategy';
import { InventoryCostCalculationService } from './inventory-cost-calculation.service';
import { InventoryValuationService } from './inventory-valuation.service';
import { InventoryCostingController } from './inventory-costing.controller';

/**
 * Phase 11 core (spec Development Order steps 1-7): costing policy +
 * dimension resolution, FIFO and Weighted-Average engines, and the
 * orchestrator posting handlers call to cost a movement. Backdated
 * recalculation, period finalization, cost adjustments and the full
 * report/health suite are out of scope for this build (see module
 * docstring in inventory-cost-calculation.service.ts).
 */
@Module({
  imports: [PrismaModule, OrgStructureModule],
  providers: [
    InventoryCostingPolicyService,
    InventoryCostingDimensionService,
    FIFOCostingStrategy,
    WeightedAverageCostingStrategy,
    InventoryCostCalculationService,
    InventoryValuationService,
  ],
  controllers: [InventoryCostingController],
  exports: [InventoryCostCalculationService, InventoryCostingPolicyService],
})
export class InventoryCostingModule {}
