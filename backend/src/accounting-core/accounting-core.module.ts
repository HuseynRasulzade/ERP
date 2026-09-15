import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PeriodModule } from '../period/period.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';

import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountService } from './account.service';
import { AccountingMappingService } from './accounting-mapping.service';
import { AccountingPostingEngine } from './accounting-posting-engine.service';
import { ManualOperationService } from './manual-operation.service';
import { AccountingQueryService } from './accounting-query.service';

import { AccountsController, ChartOfAccountsController } from './accounts.controller';
import { AccountingMappingsController } from './accounting-mappings.controller';
import { ManualOperationsController } from './manual-operations.controller';
import { AccountingReportsController } from './accounting-reports.controller';

/**
 * Accounting Core (docx spec Phase 4). Exports ChartOfAccountsService,
 * AccountingMappingService and AccountingPostingEngine so a later module
 * (Tax Engine, and eventually Sales/Purchase reconciliation) can post real
 * journal entries without reimplementing any ledger logic.
 */
@Module({
  imports: [PrismaModule, PeriodModule, AuditModule, NumberingModule, OrgStructureModule],
  controllers: [
    AccountsController,
    ChartOfAccountsController,
    AccountingMappingsController,
    ManualOperationsController,
    AccountingReportsController,
  ],
  providers: [
    ChartOfAccountsService,
    AccountService,
    AccountingMappingService,
    AccountingPostingEngine,
    ManualOperationService,
    AccountingQueryService,
  ],
  exports: [ChartOfAccountsService, AccountingMappingService, AccountingPostingEngine, AccountService, AccountingQueryService],
})
export class AccountingCoreModule {}
