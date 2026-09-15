import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * ExpenseCategoryService (spec sections 7-8). Each category carries its
 * own policy limits directly (spec section 9's own dimensioned
 * `ExpensePolicy` is folded in here — a single per-category limit rather
 * than a full multi-dimensional rule engine, disclosed simplification,
 * see docs/EXPENSES.md) — `ExpenseClaimPostingHandler` never hardcodes a
 * threshold.
 */
@Injectable()
export class ExpenseCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { code: string; name: string; accountingMappingProfile?: string; vatTreatmentProfile?: string; receiptRequirement?: string; receiptThreshold?: number; businessPurposeRequired?: boolean; allowedPaymentMethods?: string; prepaidEligible?: boolean; capitalizableEligible?: boolean; fixedAssetEligible?: boolean; inventoryCostEligible?: boolean; allocationRequired?: boolean; perTransactionLimit?: number },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.expenseCategory.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        accountingMappingProfile: dto.accountingMappingProfile,
        vatTreatmentProfile: dto.vatTreatmentProfile,
        receiptRequirement: dto.receiptRequirement ?? 'REQUIRED_ABOVE_THRESHOLD',
        receiptThreshold: dto.receiptThreshold?.toString(),
        businessPurposeRequired: dto.businessPurposeRequired ?? false,
        allowedPaymentMethods: dto.allowedPaymentMethods,
        prepaidEligible: dto.prepaidEligible ?? false,
        capitalizableEligible: dto.capitalizableEligible ?? false,
        fixedAssetEligible: dto.fixedAssetEligible ?? false,
        inventoryCostEligible: dto.inventoryCostEligible ?? false,
        allocationRequired: dto.allocationRequired ?? false,
        perTransactionLimit: dto.perTransactionLimit?.toString(),
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_CATEGORY_CREATED', entityType: 'EXPENSE_CATEGORY', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code, name: dto.name } });
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.expenseCategory.findMany({ where: { tenantId, organizationId, active: true }, orderBy: { code: 'asc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.expenseCategory.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('ExpenseCategory', id);
    return row;
  }
}
