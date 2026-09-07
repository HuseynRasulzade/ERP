import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ResponsiblePersonService } from './responsible-person.service';
import { CreateResponsiblePersonDto, UpdateResponsiblePersonDto } from './dto/responsible-person.dto';
import { VersionedCommandDto } from './dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Tenant-global, not organization-scoped (section 10/44). */
@Controller('responsible-persons')
export class ResponsiblePersonController {
  constructor(private readonly persons: ResponsiblePersonService) {}

  @RequirePermissions(PermissionCodes.RESPONSIBLE_PERSON_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('includeInactive') includeInactive?: string) {
    return this.persons.list(tenantId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.RESPONSIBLE_PERSON_MANAGE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateResponsiblePersonDto) {
    return this.persons.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.RESPONSIBLE_PERSON_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.persons.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.RESPONSIBLE_PERSON_MANAGE)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateResponsiblePersonDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.persons.update(tenantId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.RESPONSIBLE_PERSON_MANAGE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.persons.deactivate(tenantId, id, user.userId, dto.expectedVersion);
  }
}
