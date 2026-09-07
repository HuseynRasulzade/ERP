import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * Reusable structural domain validations (section 27) shared by every
 * Phase 1 entity service — never re-implement "does this branch belong to
 * this organization" logic per module.
 */
@Injectable()
export class StructuralValidationService {
  constructor(private readonly prisma: PrismaService) {}

  assertActive(entity: { active: boolean }, label: string) {
    if (!entity.active) {
      throw new ValidationAppError(`${label} is inactive and cannot be used for new records`);
    }
  }

  async getOwnedOrganization(tenantId: string, organizationId: string) {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId, tenantId } });
    if (!org) throw new NotFoundAppError('Organization', organizationId);
    return org;
  }

  /** Section 6/11/13/14: a branch/warehouse/cashbox optionally attached to a
   * branch must belong to the SAME organization as the parent record. */
  async assertBranchBelongsToOrganization(organizationId: string, branchId: string | null | undefined) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw new ValidationAppError('Branch does not belong to the same organization');
    }
  }

  async assertDepartmentInOrganization(organizationId: string, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const dept = await this.prisma.department.findFirst({ where: { id: departmentId, organizationId } });
    if (!dept) {
      throw new ValidationAppError('Department does not belong to the same organization');
    }
  }

  async assertWarehouseInOrganization(organizationId: string, warehouseId: string | null | undefined) {
    if (!warehouseId) return;
    const wh = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId } });
    if (!wh) {
      throw new ValidationAppError('Warehouse does not belong to the same organization (section 28)');
    }
  }

  async assertCashboxInOrganization(organizationId: string, cashboxId: string | null | undefined) {
    if (!cashboxId) return;
    const cb = await this.prisma.cashbox.findFirst({ where: { id: cashboxId, organizationId } });
    if (!cb) {
      throw new ValidationAppError('Cashbox does not belong to the same organization (section 28)');
    }
  }

  async assertBankAccountInOrganization(organizationId: string, bankAccountId: string | null | undefined) {
    if (!bankAccountId) return;
    const acc = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, organizationId } });
    if (!acc) {
      throw new ValidationAppError('Bank account does not belong to the same organization (section 28)');
    }
  }

  /** Section 10/44: a responsible person is tenant-global, not
   * organization-scoped — only the tenant must match. */
  async assertResponsiblePersonInTenant(tenantId: string, personId: string | null | undefined) {
    if (!personId) return;
    const person = await this.prisma.responsiblePerson.findFirst({ where: { id: personId, tenantId } });
    if (!person) {
      throw new ValidationAppError('Responsible person does not belong to this tenant');
    }
  }
}
