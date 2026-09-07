import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContextService } from '../context/request-context.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { SYSTEM_ADMIN_ONLY_KEY } from '../decorators/system-admin-only.decorator';
import { PermissionDeniedError } from '../errors/app-error';

/**
 * Server-side authorization enforcement (section 39/51). The frontend may
 * additionally hide a "Post" button, but this guard is what actually
 * protects the endpoint — hidden buttons are never a security control.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const systemAdminOnly = this.reflector.getAllAndOverride<boolean>(SYSTEM_ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (systemAdminOnly) {
      const user = this.requestContext.getUser();
      if (!user?.isSystemAdmin) {
        throw new PermissionDeniedError('system.admin');
      }
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const missing = required.filter((code) => !this.requestContext.hasPermission(code));
    if (missing.length > 0) {
      throw new PermissionDeniedError(missing[0]);
    }

    return true;
  }
}
