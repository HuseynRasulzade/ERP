import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * Organization-scoped access control (section 22). A tenant membership does
 * NOT automatically have access to every organization in its tenant —
 * access is an explicit grant, checked here and nowhere else, so every
 * organization-scoped service calls the same choke point.
 */
/** User columns that are safe to return inside membership/grant listings. */
export const SAFE_USER_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  locale: true,
  timezone: true,
  lastLoginAt: true,
} as const;

@Injectable()
export class OrganizationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(organizationId: string, membershipId: string, accessLevel: string, grantedBy?: string, departmentId?: string | null, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.organizationAccess.upsert({
      where: { tenantMembershipId_organizationId: { tenantMembershipId: membershipId, organizationId } },
      create: { tenantMembershipId: membershipId, organizationId, accessLevel, departmentId: departmentId ?? undefined, createdBy: grantedBy },
      update: { accessLevel, ...(departmentId !== undefined ? { departmentId: departmentId ?? null } : {}) },
    });
  }

  async revoke(organizationId: string, membershipId: string) {
    await this.prisma.organizationAccess.deleteMany({ where: { tenantMembershipId: membershipId, organizationId } });
  }

  /**
   * Grants of one organization of the CALLER'S tenant. The organization is
   * resolved inside `tenantId` first (a foreign-tenant id is NOT_FOUND, as
   * everywhere else), and the member's user row is projected to display
   * fields only — never the password hash or other credentials (Phase 0
   * sections 24/39, Phase 1 section 33).
   */
  async listGrants(tenantId: string, organizationId: string) {
    await this.assertOrganizationInTenant(tenantId, organizationId);
    return this.prisma.organizationAccess.findMany({
      where: { organizationId },
      include: { membership: { include: { user: { select: SAFE_USER_FIELDS } } }, department: true },
    });
  }

  /**
   * Scope check for grant/revoke (Phase 1 section 22 / Phase 0 section 61):
   * the organization, the membership and (if given) the home department
   * must all belong to the caller's tenant — an access row can never link
   * a membership to another tenant's organization.
   */
  async assertGrantScope(tenantId: string, organizationId: string, membershipId: string, departmentId?: string | null) {
    await this.assertOrganizationInTenant(tenantId, organizationId);
    const membership = await this.prisma.tenantMembership.findFirst({ where: { id: membershipId, tenantId }, select: { id: true } });
    if (!membership) throw new NotFoundAppError('TenantMembership', membershipId);
    if (departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, tenantId, organizationId },
        select: { id: true },
      });
      if (!department) throw new NotFoundAppError('Department', departmentId);
    }
  }

  private async assertOrganizationInTenant(tenantId: string, organizationId: string) {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId, tenantId }, select: { id: true } });
    if (!org) throw new NotFoundAppError('Organization', organizationId);
  }

  /** The calling membership's OWN grant for this organization — used to
   * auto-fill a document's department from the logged-in user's own data
   * (e.g. PurchaseRequirementService.create) without exposing anyone
   * else's access/department. */
  async getOwnGrant(tenantId: string, membershipId: string, organizationId: string) {
    await this.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.organizationAccess.findUnique({
      where: { tenantMembershipId_organizationId: { tenantMembershipId: membershipId, organizationId } },
      include: { department: true },
    });
  }

  async listAccessibleOrganizationIds(membershipId: string): Promise<string[]> {
    const grants = await this.prisma.organizationAccess.findMany({ where: { tenantMembershipId: membershipId } });
    return grants.map((g) => g.organizationId);
  }

  /**
   * The single choke point every organization-scoped service calls before
   * touching that organization's data (section 21): membership must have an
   * explicit grant for this exact organization, in this exact tenant. A
   * missing grant reads identically to a missing/foreign organization —
   * never distinguishable from the outside (mirrors the Phase 0 tenant
   * isolation behavior).
   */
  async assertAccess(tenantId: string, membershipId: string, organizationId: string) {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId, tenantId } });
    if (!org) throw new NotFoundAppError('Organization', organizationId);

    const grant = await this.prisma.organizationAccess.findUnique({
      where: { tenantMembershipId_organizationId: { tenantMembershipId: membershipId, organizationId } },
    });
    if (!grant) throw new NotFoundAppError('Organization', organizationId);

    return org;
  }
}
