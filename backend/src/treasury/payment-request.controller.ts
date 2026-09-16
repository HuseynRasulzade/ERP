import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentRequestService } from './payment-request.service';
import { CreatePaymentRequestDto, CancelPaymentRequestDto } from './dto/treasury.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/payment-requests')
export class PaymentRequestController {
  constructor(private readonly requests: PaymentRequestService) {}

  @RequirePermissions(PermissionCodes.PAYMENT_REQUEST_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    return this.requests.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_REQUEST_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.requests.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_REQUEST_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePaymentRequestDto,
  ) {
    return this.requests.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_REQUEST_CANCEL)
  @Post(':id/cancel')
  cancel(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CancelPaymentRequestDto,
  ) {
    return this.requests.cancel(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
