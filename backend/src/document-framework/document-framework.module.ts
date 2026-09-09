import { Module } from '@nestjs/common';
import { DocumentFrameworkRegistry } from './document-framework-registry.service';
import { DocumentPostingService } from './document-posting.service';
import { DocumentCommandsController } from './document-commands.controller';
import { PeriodModule } from '../period/period.module';
import { AuditModule } from '../audit/audit.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

/**
 * The reusable posting/document framework itself. Deliberately has ZERO
 * knowledge of any concrete document TYPE — modules like
 * FoundationTestDocumentModule depend on this module and register their
 * handler/repository/mapper into DocumentFrameworkRegistry on init.
 *
 * It does, as of the Accounting Core/Tax Engine reconciliation, depend on
 * AccountingCoreModule: DocumentPostingService generically hands a
 * handler's optional `buildAccountingBatch` result to
 * AccountingPostingEngine inside the same posting transaction (see that
 * file's docstring). This is a one-way dependency (accounting-core never
 * imports document-framework) — not a document-type-specific branch.
 */
@Module({
  imports: [PeriodModule, AuditModule, AccountingCoreModule],
  controllers: [DocumentCommandsController],
  providers: [DocumentFrameworkRegistry, DocumentPostingService],
  exports: [DocumentFrameworkRegistry, DocumentPostingService],
})
export class DocumentFrameworkModule {}
