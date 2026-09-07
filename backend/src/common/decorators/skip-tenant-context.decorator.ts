import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_CONTEXT_KEY = 'skipTenantContext';

/**
 * Marks a route as not requiring an active tenant context — e.g.
 * "list my tenant memberships", auth endpoints, or system-admin-only
 * platform operations that intentionally operate above tenant scope.
 */
export const SkipTenantContext = () => SetMetadata(SKIP_TENANT_CONTEXT_KEY, true);
