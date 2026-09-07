import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DocumentLinkService } from './document-link.service';
import { CreateBasedOnService } from './create-based-on.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('document-links')
export class DocumentLinkController {
  constructor(private readonly links: DocumentLinkService) {}

  @RequirePermissions(PermissionCodes.DOCUMENTS_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('documentType') documentType: string,
    @Query('documentId') documentId: string,
  ) {
    return this.links.listForDocument(tenantId, documentType, documentId);
  }
}

@Controller('documents/:documentType/:documentId/create-based-on')
export class CreateBasedOnController {
  constructor(private readonly createBasedOn: CreateBasedOnService) {}

  @RequirePermissions(PermissionCodes.DOCUMENTS_VIEW)
  @Get('targets')
  targets(@Param('documentType') documentType: string) {
    return { targetDocumentTypes: this.createBasedOn.getAvailableTargetDocumentTypes(documentType) };
  }

  @RequirePermissions(PermissionCodes.DOCUMENTS_CREATE)
  @Post(':targetDocumentType')
  create(
    @CurrentTenantId() tenantId: string,
    @Param('documentType') documentType: string,
    @Param('documentId') documentId: string,
    @Param('targetDocumentType') targetDocumentType: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.createBasedOn.createBasedOn(tenantId, documentType, documentId, targetDocumentType, user.userId);
  }
}
