import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PhysicalPersonService } from './physical-person.service';
import {
  CreatePhysicalPersonDto,
  UpdatePhysicalPersonDto,
} from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('hr/physical-persons')
export class PhysicalPersonController {
  constructor(private readonly persons: PhysicalPersonService) {}

  @RequirePermissions(PermissionCodes.HR_PERSON_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.persons.list(tenantId, activeOnly === 'true');
  }

  @RequirePermissions(PermissionCodes.HR_PERSON_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.persons.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.HR_PERSON_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePhysicalPersonDto,
  ) {
    return this.persons.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_PERSON_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdatePhysicalPersonDto,
  ) {
    return this.persons.update(tenantId, user.userId, id, dto);
  }
}
