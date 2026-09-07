import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContextRequiredError } from '../errors/app-error';

/** Returns the resolved tenant id for this request. Never trust a tenant_id
 * submitted in the request body/query — always read it from here. */
export const CurrentTenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const tenantId = request.tenantContextTenantId;
  if (!tenantId) throw new TenantContextRequiredError();
  return tenantId;
});
