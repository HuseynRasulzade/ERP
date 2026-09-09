import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TaxRegistrationService } from './tax-registration.service';
import { CreateTaxRegistrationDto } from './dto/tax-engine.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/tax-registrations')
export class TaxRegistrationsController {
  constructor(private readonly service: TaxRegistrationService) {}

  @RequirePermissions(PermissionCodes.TAX_REGISTRATION_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.service.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TAX_REGISTRATION_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateTaxRegistrationDto,
  ) {
    return this.service.create(tenantId, membershipId, organizationId, user.userId, {
      taxType: dto.taxType,
      registrationNumber: dto.registrationNumber,
      validFrom: parseDate(dto.validFrom),
      validTo: dto.validTo ? parseDate(dto.validTo) : undefined,
      status: dto.status,
    });
  }
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}
