import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

import { FixedAssetMovementService } from './fixed-asset-movement.service';
import { FixedAssetCategoryService } from './fixed-asset-category.service';
import { FixedAssetAcquisitionCandidateService } from './fixed-asset-acquisition-candidate.service';
import { CapitalInvestmentProjectService } from './capital-investment-project.service';

import { FixedAssetCapitalizationRepository } from './fixed-asset-capitalization.repository';
import { FixedAssetCapitalizationPostingHandler } from './fixed-asset-capitalization.posting-handler';
import { FixedAssetCapitalizationService } from './fixed-asset-capitalization.service';

import { FixedAssetService } from './fixed-asset.service';
import { FixedAssetCommissioningService } from './fixed-asset-commissioning.service';

import { FixedAssetTransferRepository } from './fixed-asset-transfer.repository';
import { FixedAssetTransferPostingHandler } from './fixed-asset-transfer.posting-handler';
import { FixedAssetTransferService } from './fixed-asset-transfer.service';

import { FixedAssetModernizationRepository } from './fixed-asset-modernization.repository';
import { FixedAssetModernizationPostingHandler } from './fixed-asset-modernization.posting-handler';
import { FixedAssetModernizationService } from './fixed-asset-modernization.service';

import { FixedAssetImpairmentRepository } from './fixed-asset-impairment.repository';
import { FixedAssetImpairmentPostingHandler } from './fixed-asset-impairment.posting-handler';
import { FixedAssetImpairmentService } from './fixed-asset-impairment.service';

import { FixedAssetRevaluationRepository } from './fixed-asset-revaluation.repository';
import { FixedAssetRevaluationPostingHandler } from './fixed-asset-revaluation.posting-handler';
import { FixedAssetRevaluationService } from './fixed-asset-revaluation.service';

import { FixedAssetSuspensionService } from './fixed-asset-suspension.service';

import { FixedAssetDisposalRepository } from './fixed-asset-disposal.repository';
import { FixedAssetDisposalPostingHandler } from './fixed-asset-disposal.posting-handler';
import { FixedAssetDisposalService } from './fixed-asset-disposal.service';

import { FixedAssetDepreciationService } from './fixed-asset-depreciation.service';
import { FixedAssetInventoryService } from './fixed-asset-inventory.service';
import { FixedAssetOpeningBalanceService } from './fixed-asset-opening-balance.service';
import { FixedAssetReportingService } from './fixed-asset-reporting.service';
import { FixedAssetHealthService } from './fixed-asset-health.service';
import { FixedAssetReconciliationService } from './fixed-asset-reconciliation.service';

import { FixedAssetController } from './fixed-asset.controller';

/**
 * Fixed Assets Engine (docx spec Phase 16). See docs/FIXED_ASSETS.md.
 * `FixedAssetAcquisitionCandidateService.createFromSource` is the
 * integration point Phase 9's Purchase Invoice FIXED_ASSET line type (and
 * any later phase) calls into — exported for exactly that, without this
 * module needing to import Purchase/Sales/Warehouse back (avoids a cycle;
 * the dependency direction is those modules -> this one, never reversed).
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule],
  controllers: [FixedAssetController],
  providers: [
    FixedAssetMovementService,
    FixedAssetCategoryService,
    FixedAssetAcquisitionCandidateService,
    CapitalInvestmentProjectService,

    FixedAssetCapitalizationRepository,
    FixedAssetCapitalizationPostingHandler,
    FixedAssetCapitalizationService,

    FixedAssetService,
    FixedAssetCommissioningService,

    FixedAssetTransferRepository,
    FixedAssetTransferPostingHandler,
    FixedAssetTransferService,

    FixedAssetModernizationRepository,
    FixedAssetModernizationPostingHandler,
    FixedAssetModernizationService,

    FixedAssetImpairmentRepository,
    FixedAssetImpairmentPostingHandler,
    FixedAssetImpairmentService,

    FixedAssetRevaluationRepository,
    FixedAssetRevaluationPostingHandler,
    FixedAssetRevaluationService,

    FixedAssetSuspensionService,

    FixedAssetDisposalRepository,
    FixedAssetDisposalPostingHandler,
    FixedAssetDisposalService,

    FixedAssetDepreciationService,
    FixedAssetInventoryService,
    FixedAssetOpeningBalanceService,
    FixedAssetReportingService,
    FixedAssetHealthService,
    FixedAssetReconciliationService,
  ],
  exports: [FixedAssetAcquisitionCandidateService, CapitalInvestmentProjectService, FixedAssetMovementService, FixedAssetService, FixedAssetDepreciationService, FixedAssetReconciliationService],
})
export class FixedAssetModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly capitalizationRepository: FixedAssetCapitalizationRepository,
    private readonly capitalizationHandler: FixedAssetCapitalizationPostingHandler,
    private readonly transferRepository: FixedAssetTransferRepository,
    private readonly transferHandler: FixedAssetTransferPostingHandler,
    private readonly modernizationRepository: FixedAssetModernizationRepository,
    private readonly modernizationHandler: FixedAssetModernizationPostingHandler,
    private readonly impairmentRepository: FixedAssetImpairmentRepository,
    private readonly impairmentHandler: FixedAssetImpairmentPostingHandler,
    private readonly revaluationRepository: FixedAssetRevaluationRepository,
    private readonly revaluationHandler: FixedAssetRevaluationPostingHandler,
    private readonly disposalRepository: FixedAssetDisposalRepository,
    private readonly disposalHandler: FixedAssetDisposalPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.capitalizationRepository);
    this.registry.registerHandler(this.capitalizationHandler);
    this.registry.registerRepository(this.transferRepository);
    this.registry.registerHandler(this.transferHandler);
    this.registry.registerRepository(this.modernizationRepository);
    this.registry.registerHandler(this.modernizationHandler);
    this.registry.registerRepository(this.impairmentRepository);
    this.registry.registerHandler(this.impairmentHandler);
    this.registry.registerRepository(this.revaluationRepository);
    this.registry.registerHandler(this.revaluationHandler);
    this.registry.registerRepository(this.disposalRepository);
    this.registry.registerHandler(this.disposalHandler);
  }
}
