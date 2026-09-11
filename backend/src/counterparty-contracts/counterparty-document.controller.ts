import { Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CounterpartyDocumentService, MAX_FILE_SIZE_BYTES } from './counterparty-document.service';
import { UploadCounterpartyDocumentDto } from './dto/counterparty-document.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * CounterpartyDocument controller (spec section 7). Files attach to a
 * contract or an amendment via `ownerType`/`ownerId` in the multipart
 * body — validated against the real owner (existence + org/tenant scope)
 * in the service, never trusted blindly. `VersionedCommandDto` on delete
 * is intentionally NOT used here: a document has no `version` field of
 * its own (immutable metadata row, superseded by re-upload rather than
 * edited in place), so delete is a plain soft-delete by id.
 */
@Controller('organizations/:organizationId/counterparty-documents')
export class CounterpartyDocumentController {
  constructor(private readonly documents: CounterpartyDocumentService) {}

  @RequirePermissions(PermissionCodes.CONTRACT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('ownerType') ownerType: string,
    @Query('ownerId') ownerId: string,
  ) {
    return this.documents.list(tenantId, membershipId, organizationId, ownerType, ownerId);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_DOCUMENT_MANAGE)
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_BYTES + 1024 } }))
  upload(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UploadCounterpartyDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(tenantId, membershipId, organizationId, dto.ownerType, dto.ownerId, user.userId, file, dto.notes);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_VIEW)
  @Get(':id/download')
  async download(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { doc, buffer } = await this.documents.getFile(tenantId, membershipId, organizationId, id);
    res.setHeader('Content-Type', doc.fileType);
    // inline (not attachment) so PDFs/images preview in-browser; the
    // filename still guides "Save As" when the viewer can't render it.
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    res.send(buffer);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_DOCUMENT_MANAGE)
  @Post(':id/delete')
  delete(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.documents.delete(tenantId, membershipId, organizationId, id, user.userId);
  }
}
