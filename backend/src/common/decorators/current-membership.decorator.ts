import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContextRequiredError } from '../errors/app-error';

/** Returns the resolved TenantMembership id for this request — the row
 * OrganizationAccess grants are attached to (section 22). */
export const CurrentMembershipId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const membershipId = request.tenantContextMembershipId;
  if (!membershipId) throw new TenantContextRequiredError();
  return membershipId;
});
