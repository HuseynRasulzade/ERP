import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentAllocationService } from './payment-allocation.service';
import { ManualAllocateDto, AutoAllocateDto, ApplyAdvanceDto } from './dto/settlement.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

@Controller('organizations/:organizationId/settlements/allocations')
export class SettlementAllocationController {
  constructor(
    private readonly allocations: PaymentAllocationService,
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('paymentDocumentId') paymentDocumentId?: string, @Query('targetOpenItemId') targetOpenItemId?: string) {
    return this.allocations.list(tenantId, membershipId, organizationId, { paymentDocumentId, targetOpenItemId });
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_ALLOCATE)
  @Post()
  async allocate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: ManualAllocateDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction((tx) =>
      this.allocations.allocate(
        tenantId,
        {
          organizationId,
          counterpartyId: dto.counterpartyId,
          role: dto.role,
          paymentDocumentType: dto.paymentDocumentType,
          paymentDocumentId: dto.paymentDocumentId,
          paymentLineId: dto.paymentLineId,
          contractId: dto.contractId,
          paymentCurrencyId: dto.paymentCurrencyId,
          paymentDate: new Date(dto.paymentDate),
          allocationType: dto.allocationType ?? 'MANUAL',
          lines: dto.lines,
          createdBy: user.userId,
        },
        tx,
      ),
    );
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_AUTO_ALLOCATE)
  @Post('auto')
  async autoAllocate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: AutoAllocateDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction((tx) =>
      this.allocations.autoAllocate(
        tenantId,
        {
          organizationId,
          counterpartyId: dto.counterpartyId,
          role: dto.role,
          paymentDocumentType: dto.paymentDocumentType,
          paymentDocumentId: dto.paymentDocumentId,
          paymentCurrencyId: dto.paymentCurrencyId,
          paymentDate: new Date(dto.paymentDate),
          paymentAmount: dto.paymentAmount,
          strategy: dto.strategy,
          contractId: dto.contractId,
          createdBy: user.userId,
        },
        tx,
      ),
    );
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_REVERSE_ALLOCATION)
  @Post(':id/reverse')
  reverse(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.allocations.reverse(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_APPLY_ADVANCE)
  @Post('apply-advance')
  applyAdvance(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: ApplyAdvanceDto) {
    return this.allocations.applyAdvance(tenantId, membershipId, organizationId, user.userId, dto);
  }
}
