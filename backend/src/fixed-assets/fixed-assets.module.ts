import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PeriodModule } from '../period/period.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { DepreciationStrategyRegistry } from './depreciation/depreciation-strategies';
import { FixedAssetSettingsService } from './fixed-asset-settings.service';
import { FixedAssetAcquisitionService } from './fixed-asset-acquisition.service';
import { CapitalInvestmentService } from './capital-investment.service';
import { FixedAssetService } from './fixed-asset.service';
import { FixedAssetCapitalizationService } from './fixed-asset-capitalization.service';
import { FixedAssetAcceptanceService } from './fixed-asset-acceptance.service';
import { FixedAssetCommissioningService } from './fixed-asset-commissioning.service';
import { FixedAssetTransferService } from './fixed-asset-transfer.service';
import { FixedAssetModernizationService } from './fixed-asset-modernization.service';
import { FixedAssetImpairmentService } from './fixed-asset-impairment.service';
import { FixedAssetRevaluationService } from './fixed-asset-revaluation.service';
import { FixedAssetDisposalService } from './fixed-asset-disposal.service';
import { FixedAssetComponentService } from './fixed-asset-component.service';
import { FixedAssetDepreciationService } from './fixed-asset-depreciation.service';
import { FixedAssetInventoryService } from './fixed-asset-inventory.service';
import { FixedAssetReconciliationService } from './fixed-asset-reconciliation.service';
import { FixedAssetReportingService } from './fixed-asset-reporting.service';
import { FixedAssetsIntegrationService } from './fixed-assets-integration.service';
import {
  CapitalInvestmentController,
  FixedAssetAcquisitionController,
  FixedAssetDepreciationController,
  FixedAssetDocumentsController,
  FixedAssetInventoryController,
  FixedAssetLocationsController,
  FixedAssetReportsController,
  FixedAssetSettingsController,
} from './fixed-asset-operations.controllers';
import { FixedAssetsController } from './fixed-assets.controller';

/**
 * Fixed Assets / Əsas vəsaitlər (docx spec Phase 16) — see
 * docs/PHASE16_FIXED_ASSETS.md. FixedAssetsController is registered LAST
 * so its `:id` routes never shadow the sibling controllers' static paths.
 */
@Module({
  imports: [PrismaModule, AuditModule, NumberingModule, PeriodModule, OrgStructureModule, AccountingCoreModule, IdempotencyModule],
  controllers: [
    FixedAssetSettingsController,
    FixedAssetLocationsController,
    FixedAssetAcquisitionController,
    CapitalInvestmentController,
    FixedAssetDepreciationController,
    FixedAssetInventoryController,
    FixedAssetDocumentsController,
    FixedAssetReportsController,
    FixedAssetsController,
  ],
  providers: [
    FixedAssetAccountingService,
    FixedAssetLedgerService,
    FixedAssetHistoryService,
    FixedAssetDocumentService,
    DepreciationPolicyService,
    DepreciationStrategyRegistry,
    FixedAssetSettingsService,
    FixedAssetAcquisitionService,
    CapitalInvestmentService,
    FixedAssetService,
    FixedAssetCapitalizationService,
    FixedAssetAcceptanceService,
    FixedAssetCommissioningService,
    FixedAssetTransferService,
    FixedAssetModernizationService,
    FixedAssetImpairmentService,
    FixedAssetRevaluationService,
    FixedAssetDisposalService,
    FixedAssetComponentService,
    FixedAssetDepreciationService,
    FixedAssetInventoryService,
    FixedAssetReconciliationService,
    FixedAssetReportingService,
    FixedAssetsIntegrationService,
  ],
  exports: [FixedAssetsIntegrationService],
})
export class FixedAssetsModule {}
