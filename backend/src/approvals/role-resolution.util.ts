import { PrismaTransactionClient } from '../prisma/prisma.service';

/**
 * Approval-step eligibility is checked by ROLE CODE, not permission code —
 * a deliberate, narrow exception to the "only check permission codes in
 * business logic" convention (see rbac.service.ts's header comment):
 * approval needs to distinguish which of several named approver
 * categories (procurement officer vs department head vs director vs
 * finance vs accounting) a user belongs to, which a single flat
 * `purchase.order.approve` permission cannot express on its own — every
 * approver already needs that permission too (enforced by the controller
 * guard); this only narrows WHICH step they may act on.
 */
export async function userHasRole(tenantId: string, userId: string, roleCode: string, tx: PrismaTransactionClient): Promise<boolean> {
  const count = await tx.membershipRole.count({
    where: {
      role: { tenantId, code: roleCode },
      membership: { tenantId, userId, status: 'ACTIVE' },
    },
  });
  return count > 0;
}

/** Does this user hold `roleCode` AND have `departmentId` as their home
 * department (via OrganizationAccess) within `organizationId`? */
export async function userHasRoleInDepartment(
  tenantId: string,
  organizationId: string,
  userId: string,
  roleCode: string,
  departmentId: string,
  tx: PrismaTransactionClient,
): Promise<boolean> {
  const count = await tx.membershipRole.count({
    where: {
      role: { tenantId, code: roleCode },
      membership: {
        tenantId,
        userId,
        status: 'ACTIVE',
        organizationAccess: { some: { organizationId, departmentId } },
      },
    },
  });
  return count > 0;
}
