import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

export interface AuthenticatedUserContext {
  userId: string;
  email: string;
  isSystemAdmin: boolean;
}

export interface TenantContextData {
  tenantId: string;
  membershipId: string;
  permissions: string[];
}

/**
 * TenantContextService (section 70).
 *
 * The single, authoritative place the rest of the application reads
 * "who is calling" and "which tenant are they acting in". Security-sensitive
 * values (tenant_id, user_id, permissions) must always be resolved from here
 * — NEVER trusted from request body/query params (section 39/61).
 */
@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService) {}

  get requestId(): string | undefined {
    return this.cls.get('requestId');
  }

  get correlationId(): string | undefined {
    return this.cls.get('correlationId');
  }

  setUser(user: AuthenticatedUserContext) {
    this.cls.set('user', user);
  }

  getUser(): AuthenticatedUserContext | undefined {
    return this.cls.get('user');
  }

  requireUser(): AuthenticatedUserContext {
    const user = this.getUser();
    if (!user) {
      throw new Error('RequestContextService: no authenticated user in context');
    }
    return user;
  }

  setTenant(tenant: TenantContextData) {
    this.cls.set('tenant', tenant);
  }

  getTenant(): TenantContextData | undefined {
    return this.cls.get('tenant');
  }

  /** Throws TENANT_CONTEXT_REQUIRED (via caller) semantics — used by services
   * that must never silently operate without a resolved tenant. */
  requireTenantId(): string {
    const tenant = this.getTenant();
    if (!tenant) {
      throw new TenantContextMissingError();
    }
    return tenant.tenantId;
  }

  hasPermission(code: string): boolean {
    const tenant = this.getTenant();
    if (!tenant) return false;
    return tenant.permissions.includes(code);
  }
}

export class TenantContextMissingError extends Error {
  code = 'TENANT_CONTEXT_REQUIRED';
  constructor() {
    super('No active tenant context resolved for this request');
  }
}
