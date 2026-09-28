import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

import { FixedAssetBalanceService } from './fixed-asset-balance.service';

import { FixedAssetCategoryService } from './fixed-asset-category.service';
import { FixedAssetCategoryController } from './fixed-asset-category.controller';

import { FixedAssetAcquisitionCandidateService } from './fixed-asset-acquisition-candidate.service';
import { FixedAssetAcquisitionCandidateController } from './fixed-asset-acquisition-candidate.controller';

import { CapitalInvestmentProjectService } from './capital-investment-project.service';
import { CapitalInvestmentProjectController } from './capital-investment-project.controller';

import { FixedAssetService } from './fixed-asset.service';
import { FixedAssetController } from './fixed-asset.controller';

import { FixedAssetDepreciationService } from './fixed-asset-depreciation.service';
import { FixedAssetDepreciationController } from './fixed-asset-depreciation.controller';

import { FixedAssetModernizationRepository } from './fixed-asset-modernization.repository';
import { FixedAssetModernizationPostingHandler } from './fixed-asset-modernization.posting-handler';
import { FixedAssetModernizationService } from './fixed-asset-modernization.service';
import { FixedAssetModernizationController } from './fixed-asset-modernization.controller';

import { FixedAssetImpairmentRepository } from './fixed-asset-impairment.repository';
import { FixedAssetImpairmentPostingHandler } from './fixed-asset-impairment.posting-handler';
import { FixedAssetImpairmentService } from './fixed-asset-impairment.service';
import { FixedAssetImpairmentController } from './fixed-asset-impairment.controller';

import { FixedAssetDisposalRepository } from './fixed-asset-disposal.repository';
import { FixedAssetDisposalPostingHandler } from './fixed-asset-disposal.posting-handler';
import { FixedAssetDisposalService } from './fixed-asset-disposal.service';
import { FixedAssetDisposalController } from './fixed-asset-disposal.controller';

import { FixedAssetInventoryCountService } from './fixed-asset-inventory-count.service';
import { FixedAssetInventoryCountController } from './fixed-asset-inventory-count.controller';

import { FixedAssetReconciliationService } from './fixed-asset-reconciliation.service';
import { FixedAssetHealthService } from './fixed-asset-health.service';
import { FixedAssetReconciliationController } from './fixed-asset-reconciliation.controller';

import { FixedAssetReportingService } from './fixed-asset-reporting.service';
import { FixedAssetReportingController } from './fixed-asset-reporting.controller';

/**
 * Fixed Asset Subledger (docx spec Phase 16) — Acquisition Candidate -> CIP
 * -> Fixed Asset Card -> Acceptance/Commissioning -> Depreciation ->
 * Transfer/Modernization/Impairment -> Disposal. See docs/FIXED_ASSETS.md
 * for the full architecture and disclosed simplifications.
 */
@Module({
  imports: [
    DocumentFrameworkModule,
    NumberingModule,
    AuditModule,
    OrgStructureModule,
    AccountingCoreModule,
  ],
  controllers: [
    FixedAssetCategoryController,
    FixedAssetAcquisitionCandidateController,
    CapitalInvestmentProjectController,
    FixedAssetDepreciationController,
    FixedAssetModernizationController,
    FixedAssetImpairmentController,
    FixedAssetDisposalController,
    FixedAssetInventoryCountController,
    // Static-path sibling routes (reconciliation/health/reports) MUST be
    // registered before FixedAssetController's own `GET/:id` — Nest
    // matches routes in registration order, so `:id` would otherwise
    // swallow e.g. GET .../fixed-assets/reconciliation as id="reconciliation".
    FixedAssetReconciliationController,
    FixedAssetReportingController,
    FixedAssetController,
  ],
  providers: [
    FixedAssetBalanceService,
    FixedAssetCategoryService,
    FixedAssetAcquisitionCandidateService,
    CapitalInvestmentProjectService,
    FixedAssetService,
    FixedAssetDepreciationService,
    FixedAssetModernizationRepository,
    FixedAssetModernizationPostingHandler,
    FixedAssetModernizationService,
    FixedAssetImpairmentRepository,
    FixedAssetImpairmentPostingHandler,
    FixedAssetImpairmentService,
    FixedAssetDisposalRepository,
    FixedAssetDisposalPostingHandler,
    FixedAssetDisposalService,
    FixedAssetInventoryCountService,
    FixedAssetReconciliationService,
    FixedAssetHealthService,
    FixedAssetReportingService,
  ],
})
export class FixedAssetsModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly modernizationRepository: FixedAssetModernizationRepository,
    private readonly modernizationHandler: FixedAssetModernizationPostingHandler,
    private readonly impairmentRepository: FixedAssetImpairmentRepository,
    private readonly impairmentHandler: FixedAssetImpairmentPostingHandler,
    private readonly disposalRepository: FixedAssetDisposalRepository,
    private readonly disposalHandler: FixedAssetDisposalPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.modernizationRepository);
    this.registry.registerHandler(this.modernizationHandler);
    this.registry.registerRepository(this.impairmentRepository);
    this.registry.registerHandler(this.impairmentHandler);
    this.registry.registerRepository(this.disposalRepository);
    this.registry.registerHandler(this.disposalHandler);
  }
}
