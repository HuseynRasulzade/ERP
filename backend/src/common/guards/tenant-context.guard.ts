import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContextService } from '../context/request-context.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_TENANT_CONTEXT_KEY } from '../decorators/skip-tenant-context.decorator';
import { NotFoundAppError } from '../errors/app-error';

/**
 * Resolves the tenant a request executes in (section 4: "every API/business
 * operation executes inside a tenant context") and rejects cross-tenant
 * access with a NOT_FOUND-shaped error so an ID from another tenant behaves
 * as inaccessible rather than leaking its existence (section 4, scenario A).
 *
 * The tenant is selected via the `X-Tenant-Id` header. The caller must have
 * an ACTIVE membership in that tenant; permissions are aggregated from every
 * role attached to that membership and stored in the request context for
 * PermissionsGuard to consume.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CONTEXT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId: string; email: string; isSystemAdmin: boolean };

    this.requestContext.setUser(user);

    if (skip) return true;

    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      throw new NotFoundAppError('Tenant');
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, userId: user.userId, status: 'ACTIVE' },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });

    // Deliberately identical error/shape whether the tenant does not exist,
    // the membership does not exist, or it is disabled — no information
    // about Tenant B is ever revealed to a caller outside it.
    if (!membership) {
      throw new NotFoundAppError('Tenant');
    }

    const permissions = new Set<string>();
    for (const membershipRole of membership.roles) {
      for (const rolePermission of membershipRole.role.permissions) {
        permissions.add(rolePermission.permission.code);
      }
    }

    this.requestContext.setTenant({
      tenantId,
      membershipId: membership.id,
      permissions: Array.from(permissions),
    });
    // Convenience mirror for the @CurrentTenantId() param decorator, which
    // (unlike RequestContextService) cannot use constructor DI.
    request.tenantContextTenantId = tenantId;
    request.tenantContextMembershipId = membership.id;

    return true;
  }
}
