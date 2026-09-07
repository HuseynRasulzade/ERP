import { Body, Controller, Get, Post } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { CreateNumberSequenceDto } from './dto/numbering.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('number-sequences')
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @RequirePermissions(PermissionCodes.NUMBERING_MANAGE)
  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.numbering.listSequences(tenantId);
  }

  @RequirePermissions(PermissionCodes.NUMBERING_MANAGE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateNumberSequenceDto) {
    return this.numbering.createSequence(tenantId, dto);
  }
}
