import { PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** Validates that referenced master data exists in the same tenant /
 * organization (the FA tables keep plain id columns, not FKs, so this is
 * the integrity gate). */
export async function validateAssignmentRefs(
  tx: PrismaTransactionClient,
  tenantId: string,
  organizationId: string,
  refs: { branchId?: string | null; departmentId?: string | null; locationId?: string | null; responsiblePersonId?: string | null },
) {
  if (refs.branchId) {
    const b = await tx.branch.findFirst({ where: { id: refs.branchId, tenantId, organizationId } });
    if (!b) throw new NotFoundAppError('Branch', refs.branchId);
  }
  if (refs.departmentId) {
    const d = await tx.department.findFirst({ where: { id: refs.departmentId, tenantId, organizationId } });
    if (!d) throw new NotFoundAppError('Department', refs.departmentId);
  }
  if (refs.locationId) {
    const l = await tx.fixedAssetLocation.findFirst({ where: { id: refs.locationId, tenantId, organizationId } });
    if (!l) throw new NotFoundAppError('FixedAssetLocation', refs.locationId);
  }
  if (refs.responsiblePersonId) {
    const p = await tx.responsiblePerson.findFirst({ where: { id: refs.responsiblePersonId, tenantId } });
    if (!p) throw new NotFoundAppError('ResponsiblePerson', refs.responsiblePersonId);
  }
}
