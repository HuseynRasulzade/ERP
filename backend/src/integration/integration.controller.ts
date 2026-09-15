import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import Decimal from 'decimal.js';
import { IntegrationEndpointService } from './integration-endpoint.service';
import { IntegrationConnectorRegistry } from './integration-connector-registry.service';
import { IntegrationContractService } from './integration-contract.service';
import { IntegrationMappingService } from './integration-mapping.service';
import { IntegrationMessageService } from './integration-message.service';
import { IntegrationImportService } from './integration-import.service';
import { IntegrationDeadLetterService } from './integration-dead-letter.service';
import { ExternalEntityReferenceService } from './external-entity-reference.service';
import { IntegrationReconciliationService } from './integration-reconciliation.service';
import { IntegrationHealthService } from './integration-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import {
  CreateEndpointDto,
  CreateContractDto,
  CreateContractVersionDto,
  CreateMappingProfileDto,
  CreateMappingVersionDto,
  ReplayMessageDto,
  ManualMatchDto,
  RunReconciliationDto,
  ResolveDeadLetterDto,
} from './dto/integration.dto';

/** Integration Platform admin API (docx spec Phase 28, section 170).
 * See docs/INTEGRATION_PLATFORM.md. */
@Controller('integrations')
export class IntegrationController {
  constructor(
    private readonly endpoints: IntegrationEndpointService,
    private readonly connectors: IntegrationConnectorRegistry,
    private readonly contracts: IntegrationContractService,
    private readonly mappings: IntegrationMappingService,
    private readonly messages: IntegrationMessageService,
    private readonly imports: IntegrationImportService,
    private readonly deadLetters: IntegrationDeadLetterService,
    private readonly externalRefs: ExternalEntityReferenceService,
    private readonly reconciliation: IntegrationReconciliationService,
    private readonly health: IntegrationHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.INTEGRATION_ENDPOINT_VIEW)
  @Get('endpoints')
  listEndpoints(@CurrentTenantId() tenantId: string) {
    return this.endpoints.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_ENDPOINT_EDIT)
  @Post('endpoints')
  createEndpoint(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateEndpointDto) {
    return this.endpoints.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_ENDPOINT_VIEW)
  @Post('endpoints/:id/test')
  testEndpoint(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.endpoints.testConnection(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_CONNECTOR_VIEW)
  @Get('connectors')
  listConnectors(@CurrentTenantId() tenantId: string) {
    return this.connectors.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_CONTRACT_VIEW)
  @Get('contracts')
  listContracts(@CurrentTenantId() tenantId: string) {
    return this.contracts.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_CONTRACT_EDIT)
  @Post('contracts')
  createContract(@CurrentTenantId() tenantId: string, @Body() dto: CreateContractDto) {
    return this.contracts.createContract(tenantId, dto as never);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_CONTRACT_EDIT)
  @Post('contracts/:id/versions')
  createContractVersion(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: CreateContractVersionDto) {
    return this.contracts.createVersion(tenantId, user.userId, id, { schema: dto.schema as never, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined, backwardCompatible: dto.backwardCompatible });
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_MAPPING_VIEW)
  @Get('mappings')
  listMappings(@CurrentTenantId() tenantId: string) {
    return this.mappings.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_MAPPING_EDIT)
  @Post('mappings')
  createMappingProfile(@CurrentTenantId() tenantId: string, @Body() dto: CreateMappingProfileDto) {
    return this.mappings.createProfile(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_MAPPING_EDIT)
  @Post('mappings/:id/versions')
  createMappingVersion(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: CreateMappingVersionDto) {
    return this.mappings.createVersion(tenantId, user.userId, id, { sourceContractVersionId: dto.sourceContractVersionId, targetCanonicalContract: dto.targetCanonicalContract, fieldMappings: dto.fieldMappings as never, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined });
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_MAPPING_APPROVE)
  @Post('mappings/versions/:id/activate')
  activateMappingVersion(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.mappings.activateVersion(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_VIEW)
  @Get('messages')
  listMessages(@CurrentTenantId() tenantId: string, @Query('endpointId') endpointId?: string, @Query('status') status?: string) {
    return this.messages.list(tenantId, { endpointId, status: status as never });
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_VIEW)
  @Get('messages/:id')
  getMessage(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.messages.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_REPLAY)
  @Post('messages/:id/replay')
  replayMessage(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: ReplayMessageDto) {
    return this.imports.replayMessage(tenantId, user.userId, id, dto.contractCode, dto.mode as never, dto.canonicalData, dto.mappingVersionId);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_VIEW)
  @Get('dead-letters')
  listDeadLetters(@CurrentTenantId() tenantId: string) {
    return this.deadLetters.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_DEADLETTER_RESOLVE)
  @Post('dead-letters/:id/retry')
  requestDeadLetterRetry(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.deadLetters.requestRetry(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_DEADLETTER_RESOLVE)
  @Post('dead-letters/:id/resolve')
  resolveDeadLetter(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: ResolveDeadLetterDto) {
    return this.deadLetters.resolve(tenantId, user.userId, id, dto.resolution, dto.outcome);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_MANUAL_MATCH)
  @Post('matching/manual')
  manualMatch(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: ManualMatchDto) {
    return this.externalRefs.link(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_RECONCILIATION_RUN)
  @Post('reconciliation/:ruleId/run')
  runReconciliation(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('ruleId') ruleId: string, @Body() dto: RunReconciliationDto) {
    const toSide = (rows: { key: string; count: number; amount: number }[]) => rows.map((r) => ({ key: r.key, count: r.count, amount: new Decimal(r.amount) }));
    return this.reconciliation.run(tenantId, ruleId, dto.periodLabel, toSide(dto.externalSide), toSide(dto.internalSide), user.userId);
  }

  @RequirePermissions(PermissionCodes.INTEGRATION_VIEW)
  @Get('health')
  healthSummary(@CurrentTenantId() tenantId: string) {
    return this.health.summary(tenantId);
  }
}
