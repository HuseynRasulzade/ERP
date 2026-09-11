import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CounterpartyContractAmendmentService } from './counterparty-contract-amendment.service';
import { CreateContractAmendmentDto, SetAmendmentStatusDto, UpdateContractAmendmentDto } from './dto/counterparty-contract.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Amendments nested under one contract (spec section 6). */
@Controller('organizations/:organizationId/contracts/:contractId/amendments')
export class ContractAmendmentsForContractController {
  constructor(private readonly amendments: CounterpartyContractAmendmentService) {}

  @RequirePermissions(PermissionCodes.CONTRACT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.amendments.listForContract(tenantId, membershipId, organizationId, contractId);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_AMENDMENT_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('contractId') contractId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateContractAmendmentDto,
  ) {
    return this.amendments.create(tenantId, membershipId, organizationId, contractId, user.userId, dto);
  }
}

@Controller('organizations/:organizationId/contract-amendments')
export class ContractAmendmentController {
  constructor(private readonly amendments: CounterpartyContractAmendmentService) {}

  @RequirePermissions(PermissionCodes.CONTRACT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.amendments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_AMENDMENT_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateContractAmendmentDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.amendments.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_AMENDMENT_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.amendments.approve(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_AMENDMENT_EDIT)
  @Post(':id/status')
  setStatus(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SetAmendmentStatusDto,
  ) {
    return this.amendments.setStatus(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion, dto.status);
  }
}
