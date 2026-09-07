import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { FoundationTestDocumentService } from './foundation-test-document.service';
import { CreateFoundationTestDocumentDto, UpdateFoundationTestDocumentDto } from './dto/foundation-test-document.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Internal/demo document type (section 58). NOT a production business
 * feature — exists solely to exercise save/number/post/unpost/audit/
 * period-control/document-relationship end to end. A real business module
 * (Sales, Purchase, ...) gets its own controller shaped like this one.
 */
@Controller('foundation-test-documents')
export class FoundationTestDocumentController {
  constructor(private readonly documents: FoundationTestDocumentService) {}

  @RequirePermissions(PermissionCodes.DOCUMENTS_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.documents.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.DOCUMENTS_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.documents.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.DOCUMENTS_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateFoundationTestDocumentDto,
  ) {
    return this.documents.create(tenantId, user.userId, {
      organizationId: dto.organizationId,
      documentDate: new Date(dto.documentDate),
      currencyId: dto.currencyId,
      amount: dto.amount,
      description: dto.description,
    });
  }

  @RequirePermissions(PermissionCodes.DOCUMENTS_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateFoundationTestDocumentDto,
  ) {
    return this.documents.update(tenantId, id, user.userId, dto);
  }
}
