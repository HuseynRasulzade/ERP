import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContextRequiredError } from '../common/errors/app-error';

export interface HrRequestContext {
  tenantId: string;
  membershipId: string;
  userId: string;
}

/** Tenant + membership + acting user, resolved by the global guards (same
 * sources as @CurrentTenantId/@CurrentMembershipId/@CurrentUser — never
 * from the request body). */
export const HrCtx = createParamDecorator((_: unknown, ctx: ExecutionContext): HrRequestContext => {
  const request = ctx.switchToHttp().getRequest();
  const tenantId = request.tenantContextTenantId;
  const membershipId = request.tenantContextMembershipId;
  if (!tenantId || !membershipId) throw new TenantContextRequiredError();
  return { tenantId, membershipId, userId: request.user?.userId };
});
