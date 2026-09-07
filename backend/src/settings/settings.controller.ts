import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SetTenantSettingDto } from './dto/settings.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermissions(PermissionCodes.CORE_SETTINGS_VIEW)
  @Get(':key')
  async get(@CurrentTenantId() tenantId: string, @Param('key') key: string) {
    const value = await this.settings.getTenantSetting(tenantId, key);
    return { key, value: value ?? null };
  }

  @RequirePermissions(PermissionCodes.CORE_SETTINGS_MANAGE)
  @Post()
  set(
    @CurrentTenantId() tenantId: string,
    @Body() dto: SetTenantSettingDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.settings.setTenantSetting(
      tenantId,
      dto.key,
      dto.value,
      dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      user.userId,
    );
  }
}
