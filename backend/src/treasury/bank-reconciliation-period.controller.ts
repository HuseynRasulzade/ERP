import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BankReconciliationPeriodService } from './bank-reconciliation-period.service';
import {
  CloseBankReconciliationDto,
  CreateBankReconciliationDto,
  ReopenBankReconciliationDto,
} from './dto/bank-reconciliation.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/bank-reconciliations')
export class BankReconciliationPeriodController {
  constructor(
    private readonly reconciliations: BankReconciliationPeriodService,
  ) {}

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.reconciliations.list(
      tenantId,
      membershipId,
      organizationId,
      bankAccountId,
    );
  }

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILIATION_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.reconciliations.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.BANK_RECONCILIATION_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateBankReconciliationDto,
  ) {
    return this.reconciliations.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.BANK_RECONCILIATION_MANAGE)
  @Post(':id/refresh')
  refresh(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.reconciliations.refresh(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
  }

  @RequirePermissions(PermissionCodes.BANK_RECONCILIATION_CLOSE)
  @Post(':id/close')
  close(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CloseBankReconciliationDto,
  ) {
    return this.reconciliations.close(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.BANK_RECONCILIATION_REOPEN)
  @Post(':id/reopen')
  reopen(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReopenBankReconciliationDto,
  ) {
    return this.reconciliations.reopen(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      dto,
    );
  }
}
