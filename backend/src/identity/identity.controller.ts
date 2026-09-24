import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { LoginDto, RefreshTokenDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenantContext } from '../common/decorators/skip-tenant-context.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Brute-force/credential-stuffing surface — far tighter than the global
// default (see app.module.ts's ThrottlerModule.forRoot).
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 10 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
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
      timezone: record.timezone,
      isSystemAdmin: record.isSystemAdmin,
    };
  }

  @SkipTenantContext()
  @Patch('me')
  async updateMe(@CurrentUser() user: { userId: string }, @Body() dto: UpdateProfileDto) {
    const record = await this.identity.updateProfile(user.userId, dto);
    return {
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      locale: record.locale,
      timezone: record.timezone,
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
