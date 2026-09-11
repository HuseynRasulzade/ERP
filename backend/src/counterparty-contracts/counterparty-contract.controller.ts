import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CounterpartyContractService } from './counterparty-contract.service';
import { CreateCounterpartyContractDto, SetContractStatusDto, UpdateCounterpartyContractDto } from './dto/counterparty-contract.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Contracts nested under one counterparty (spec section 5). */
@Controller('organizations/:organizationId/counterparties/:counterpartyId/contracts')
export class CounterpartyContractsForCounterpartyController {
  constructor(private readonly contracts: CounterpartyContractService) {}

  @RequirePermissions(PermissionCodes.CONTRACT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('counterpartyId') counterpartyId: string,
  ) {
    return this.contracts.listForCounterparty(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('counterpartyId') counterpartyId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCounterpartyContractDto,
  ) {
    return this.contracts.create(tenantId, membershipId, organizationId, counterpartyId, user.userId, dto);
  }
}

/** Standalone contract operations — a contract is addressed by its own id
 * once created, independent of the counterparty path segment (mirrors how
 * every other document type in this codebase is addressed after
 * create-based-on). */
@Controller('organizations/:organizationId/contracts')
export class CounterpartyContractController {
  constructor(private readonly contracts: CounterpartyContractService) {}

  @RequirePermissions(PermissionCodes.CONTRACT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.contracts.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateCounterpartyContractDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.contracts.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.contracts.approve(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Post(':id/status')
  setStatus(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SetContractStatusDto,
  ) {
    return this.contracts.setStatus(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion, dto.status);
  }
}
