import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BankReconciliationService } from './bank-reconciliation.service';
import { CreateBankStatementLineDto, MatchBankStatementLineDto, UpdateBankStatementLineDto } from './dto/bank-reconciliation.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/bank-statement-lines')
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list(tenantId, membershipId, organizationId, bankAccountId, status);
  }

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateBankStatementLineDto,
  ) {
    return this.service.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_MANAGE)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateBankStatementLineDto,
  ) {
    return this.service.update(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  /** CSV bank statement import — must be declared before ':id' routes so
   * Nest doesn't swallow this literal path as an :id match. */
  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_MANAGE)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  importCsv(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Query('bankAccountId') bankAccountId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.importCsv(tenantId, membershipId, organizationId, bankAccountId, user.userId, file.buffer.toString('utf-8'));
  }

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_VIEW)
  @Get(':id/suggestions')
  suggestions(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.service.suggestMatches(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_MANAGE)
  @Post(':id/match')
  match(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: MatchBankStatementLineDto,
  ) {
    return this.service.match(tenantId, membershipId, organizationId, id, user.userId, dto);
  }
}
