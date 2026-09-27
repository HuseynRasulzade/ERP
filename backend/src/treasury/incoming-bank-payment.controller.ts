import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IncomingBankPaymentService } from './incoming-bank-payment.service';
import {
  CreateIncomingBankPaymentDto,
  UpdateIncomingBankPaymentDto,
} from './dto/treasury.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/incoming-bank-payments')
export class IncomingBankPaymentController {
  constructor(private readonly payments: IncomingBankPaymentService) {}

  @RequirePermissions(PermissionCodes.INCOMING_BANK_PAYMENT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.payments.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INCOMING_BANK_PAYMENT_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.payments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INCOMING_BANK_PAYMENT_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateIncomingBankPaymentDto,
  ) {
    return this.payments.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.INCOMING_BANK_PAYMENT_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateIncomingBankPaymentDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.payments.update(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      patch,
      expectedVersion,
    );
  }
}
