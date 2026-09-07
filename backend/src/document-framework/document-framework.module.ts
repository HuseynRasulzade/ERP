import { Module } from '@nestjs/common';
import { DocumentFrameworkRegistry } from './document-framework-registry.service';
import { DocumentPostingService } from './document-posting.service';
import { DocumentCommandsController } from './document-commands.controller';
import { PeriodModule } from '../period/period.module';
import { AuditModule } from '../audit/audit.module';

/**
 * The reusable posting/document framework itself. Deliberately has ZERO
 * knowledge of any concrete document type — modules like
 * FoundationTestDocumentModule depend on this module and register their
 * handler/repository/mapper into DocumentFrameworkRegistry on init.
 */
@Module({
  imports: [PeriodModule, AuditModule],
  controllers: [DocumentCommandsController],
  providers: [DocumentFrameworkRegistry, DocumentPostingService],
  exports: [DocumentFrameworkRegistry, DocumentPostingService],
})
export class DocumentFrameworkModule {}
