import { SetMetadata } from '@nestjs/common';

export const SYSTEM_ADMIN_ONLY_KEY = 'systemAdminOnly';

/**
 * Section 7: Platform/System Administrator operations are explicitly marked
 * and heavily audited, and are never reachable via ordinary tenant
 * administrator privileges.
 */
export const SystemAdminOnly = () => SetMetadata(SYSTEM_ADMIN_ONLY_KEY, true);
