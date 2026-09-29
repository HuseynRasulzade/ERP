import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExpenseReceiptService } from './expense-receipt.service';
import { UploadExpenseReceiptDto } from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/expenses/receipts')
export class ExpenseReceiptController {
  constructor(private readonly receipts: ExpenseReceiptService) {}

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('by-line/:claimLineId')
  listForLine(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('claimLineId') claimLineId: string,
  ) {
    return this.receipts.listForLine(tenantId, membershipId, organizationId, claimLineId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_CREATE)
  @Post()
  upload(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UploadExpenseReceiptDto,
  ) {
    return this.receipts.upload(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_RECEIPT_REVIEW)
  @Post(':id/review')
  review(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body('validationStatus') validationStatus: string,
  ) {
    return this.receipts.review(tenantId, membershipId, organizationId, user.userId, id, validationStatus);
  }
}
