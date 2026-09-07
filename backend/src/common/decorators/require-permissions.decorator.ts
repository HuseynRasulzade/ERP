import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Explicit machine-readable permission codes (section 6). Never write
 * `if (user.role === 'admin')` — always gate on a capability code, checked
 * server-side by PermissionsGuard regardless of what the UI hides.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
