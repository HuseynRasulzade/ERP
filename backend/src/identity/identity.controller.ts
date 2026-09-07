import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenantContext } from '../common/decorators/skip-tenant-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
    return { success: true };
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly identity: IdentityService) {}

  @SkipTenantContext()
  @Get('me')
  async me(@CurrentUser() user: { userId: string }) {
    const record = await this.identity.findById(user.userId);
    return {
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      locale: record.locale,
      isSystemAdmin: record.isSystemAdmin,
    };
  }

  @SkipTenantContext()
  @Get('me/tenants')
  async myTenants(@CurrentUser() user: { userId: string }) {
    const memberships = await this.identity.listMemberships(user.userId);
    return memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantCode: m.tenant.code,
      tenantName: m.tenant.name,
      membershipId: m.id,
      status: m.status,
    }));
  }
}
