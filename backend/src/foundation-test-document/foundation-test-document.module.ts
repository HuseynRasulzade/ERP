import { Module, OnModuleInit } from '@nestjs/common';
import { FoundationTestDocumentService } from './foundation-test-document.service';
import { FoundationTestDocumentController } from './foundation-test-document.controller';
import { FoundationTestDocumentRepository } from './foundation-test-document.repository';
import { FoundationTestDocumentPostingHandler } from './foundation-test-document.posting-handler';
import { FoundationTestDocumentSelfMapper } from './foundation-test-document.mapper';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Wires the demo document type into the shared framework. This is the
 * template later phases copy: implement Repository + PostingHandler
 * (+ optional CreateBasedOnMapper), then register them here on module init.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule],
  controllers: [FoundationTestDocumentController],
  providers: [
    FoundationTestDocumentService,
    FoundationTestDocumentRepository,
    FoundationTestDocumentPostingHandler,
    FoundationTestDocumentSelfMapper,
  ],
  exports: [FoundationTestDocumentService],
})
export class FoundationTestDocumentModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly repository: FoundationTestDocumentRepository,
    private readonly postingHandler: FoundationTestDocumentPostingHandler,
    private readonly mapper: FoundationTestDocumentSelfMapper,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.repository);
    this.registry.registerHandler(this.postingHandler);
    this.registry.registerMapper(this.mapper);
  }
}
