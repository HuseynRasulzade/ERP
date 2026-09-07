import { Body, Controller, Param, Post } from '@nestjs/common';
import { DocumentPostingService } from './document-posting.service';
import { DocumentCommandDto } from './dto/document-command.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Generic document command surface (section 62): posting is a business
 * command (`POST .../post`), never a client PATCHing `posting_status`
 * directly. Works uniformly across every document type registered in
 * DocumentFrameworkRegistry.
 */
@Controller('documents/:documentType/:documentId')
export class DocumentCommandsController {
  constructor(private readonly posting: DocumentPostingService) {}

  @RequirePermissions(PermissionCodes.DOCUMENTS_POST)
  @Post('post')
  post(
    @CurrentTenantId() tenantId: string,
    @Param('documentType') documentType: string,
    @Param('documentId') documentId: string,
    @Body() dto: DocumentCommandDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.posting.post(tenantId, documentType, documentId, dto.expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.DOCUMENTS_UNPOST)
  @Post('unpost')
  unpost(
    @CurrentTenantId() tenantId: string,
    @Param('documentType') documentType: string,
    @Param('documentId') documentId: string,
    @Body() dto: DocumentCommandDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.posting.unpost(tenantId, documentType, documentId, dto.expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.DOCUMENTS_CANCEL)
  @Post('cancel')
  cancel(
    @CurrentTenantId() tenantId: string,
    @Param('documentType') documentType: string,
    @Param('documentId') documentId: string,
    @Body() dto: DocumentCommandDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.posting.cancel(tenantId, documentType, documentId, dto.expectedVersion, user.userId);
  }
}
