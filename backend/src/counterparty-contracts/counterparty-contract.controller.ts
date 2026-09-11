import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CounterpartyContractService } from './counterparty-contract.service';
import {
  CreateContractFromPurchaseOrderDto,
  CreateContractLineDto,
  CreateCounterpartyContractDto,
  GenerateContractPaymentScheduleDto,
  SetContractAdvanceDto,
  SetContractSourcePurchaseOrderDto,
  SetContractStatusDto,
  UpdateContractLineDto,
  UpdateCounterpartyContractDto,
} from './dto/counterparty-contract.dto';
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

  /** Eligible sources for the contract form's mandatory "Alış sifarişini
   * seç" field — POSTED purchase orders for this counterparty that still
   * have remaining (uncontracted) quantity and no blank-price line. */
  @RequirePermissions(PermissionCodes.CONTRACT_CREATE)
  @Get('eligible-purchase-orders')
  eligiblePurchaseOrders(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('counterpartyId') counterpartyId: string,
  ) {
    return this.contracts.eligiblePurchaseOrdersForCounterparty(tenantId, membershipId, organizationId, counterpartyId);
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

  /** Bespoke command — a contract created from a confirmed Purchase Order
   * (spec section 11). Not the generic create-based-on mapper: it needs
   * per-line quantity allocation the mapper's 1:1 interface has no room
   * for, same reasoning as ProcurementPlanningService's own requirement
   * -> PurchaseOrder command. */
  @RequirePermissions(PermissionCodes.CONTRACT_CREATE)
  @Post('from-purchase-order')
  createFromPurchaseOrder(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateContractFromPurchaseOrderDto,
  ) {
    return this.contracts.createFromPurchaseOrder(tenantId, membershipId, organizationId, user.userId, dto);
  }

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

  /** Changes a DRAFT contract's source purchase order, discarding and
   * replacing every nomenclature line (spec: PO selection change ->
   * lines are wiped and replaced). The frontend is responsible for
   * warning the user first when the contract's `linesDirty` flag is
   * true. */
  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Post(':id/source-purchase-order')
  setSourcePurchaseOrder(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SetContractSourcePurchaseOrderDto,
  ) {
    return this.contracts.setSourcePurchaseOrder(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion, dto.purchaseOrderId);
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

  // -- Nomenclature lines (spec sections 11-13) --------------------------------

  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Post(':id/lines')
  addLine(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateContractLineDto,
  ) {
    return this.contracts.addLine(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Patch(':id/lines/:lineId')
  updateLine(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateContractLineDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.contracts.updateLine(tenantId, membershipId, organizationId, id, lineId, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Delete(':id/lines/:lineId')
  removeLine(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.contracts.removeLine(tenantId, membershipId, organizationId, id, lineId, user.userId);
  }

  // -- Advance + payment schedule (spec section 10) ----------------------------

  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Post(':id/advance')
  setAdvance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SetContractAdvanceDto,
  ) {
    const { expectedVersion, ...rest } = dto;
    return this.contracts.setAdvance(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, rest);
  }

  @RequirePermissions(PermissionCodes.CONTRACT_EDIT)
  @Post(':id/payment-schedule')
  generatePaymentSchedule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: GenerateContractPaymentScheduleDto,
  ) {
    return this.contracts.generatePaymentSchedule(tenantId, membershipId, organizationId, id, user.userId, dto.installments);
  }
}
