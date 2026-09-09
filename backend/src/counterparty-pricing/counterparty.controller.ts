import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CounterpartyService } from './counterparty.service';
import { CreateCounterpartyDto, UpdateCounterpartyDto, CreateCounterpartyAddressDto, CreateCounterpartyContactDto } from './dto/counterparty.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/counterparties')
export class CounterpartyController {
  constructor(private readonly service: CounterpartyService) {}

  @RequirePermissions(PermissionCodes.COUNTERPARTY_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('type') type?: string,
  ) {
    return this.service.list(tenantId, membershipId, organizationId, includeInactive === 'true', type);
  }

  @RequirePermissions(PermissionCodes.COUNTERPARTY_VIEW)
  @Get('search')
  search(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.search(tenantId, membershipId, organizationId, query, limit ? parseInt(limit) : 20);
  }

  @RequirePermissions(PermissionCodes.COUNTERPARTY_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCounterpartyDto,
  ) {
    return this.service.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.COUNTERPARTY_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.service.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.COUNTERPARTY_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateCounterpartyDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.service.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.COUNTERPARTY_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.service.deactivate(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.COUNTERPARTY_EDIT)
  @Post(':id/addresses')
  addAddress(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') counterpartyId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCounterpartyAddressDto,
  ) {
    return this.service.addAddress(tenantId, membershipId, organizationId, counterpartyId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.COUNTERPARTY_EDIT)
  @Post(':id/contacts')
  addContact(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') counterpartyId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCounterpartyContactDto,
  ) {
    return this.service.addContact(tenantId, membershipId, organizationId, counterpartyId, user.userId, dto);
  }
}
