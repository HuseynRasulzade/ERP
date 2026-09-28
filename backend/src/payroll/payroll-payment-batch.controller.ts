import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PayrollPaymentBatchService } from './payroll-payment-batch.service';
import { CreatePaymentBatchDto, RecordPaymentDto } from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/payroll/periods/:periodId')
export class PayrollPaymentBatchController {
  constructor(private readonly batches: PayrollPaymentBatchService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_ACCOUNTING)
  @Get('payment-batches')
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
  ) {
    return this.batches.list(tenantId, membershipId, organizationId, periodId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CREATE_PAYMENT_BATCH)
  @Post('payment-batches')
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
    @Body() dto: CreatePaymentBatchDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.batches.createAndConfirm(tenantId, membershipId, organizationId, user.userId, periodId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CREATE_PAYMENT_BATCH)
  @Post('payments')
  recordPayment(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.batches.recordPayment(tenantId, membershipId, organizationId, user.userId, periodId, dto);
  }
}

@Controller('organizations/:organizationId/payroll/payment-batches')
export class PayrollPaymentBatchLookupController {
  constructor(private readonly batches: PayrollPaymentBatchService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_ACCOUNTING)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.batches.get(tenantId, membershipId, organizationId, id);
  }
}
