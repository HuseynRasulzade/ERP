import { Module } from '@nestjs/common';
import { DocumentLinkService } from './document-link.service';
import { CreateBasedOnService } from './create-based-on.service';
import { DocumentLinkController, CreateBasedOnController } from './document-link.controller';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';

@Module({
  imports: [DocumentFrameworkModule, AuditModule, OrgStructureModule],
  controllers: [DocumentLinkController, CreateBasedOnController],
  providers: [DocumentLinkService, CreateBasedOnService],
  exports: [DocumentLinkService, CreateBasedOnService],
})
export class DocumentLinkModule {}
