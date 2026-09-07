import { Module } from '@nestjs/common';
import { DocumentLinkService } from './document-link.service';
import { CreateBasedOnService } from './create-based-on.service';
import { DocumentLinkController, CreateBasedOnController } from './document-link.controller';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DocumentFrameworkModule, AuditModule],
  controllers: [DocumentLinkController, CreateBasedOnController],
  providers: [DocumentLinkService, CreateBasedOnService],
  exports: [DocumentLinkService, CreateBasedOnService],
})
export class DocumentLinkModule {}
