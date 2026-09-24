import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { BOOK_CODES, DepreciationStartRule, PartialPeriodRule, toDate } from './fixed-assets.constants';
import { DepreciationStrategyRegistry } from './depreciation/depreciation-strategies';

export interface CategoryInput {
  code: string;
  name: string;
  organizationId?: string | null;
  defaultUsefulLifeMonths?: number | null;
  defaultDepreciationMethod?: string;
  defaultResidualValue?: number;
  defaultResidualPercent?: number | null;
  capitalizationThreshold?: number | null;
  accountingMappingProfile?: string | null;
  taxCategory?: string | null;
  componentizationAllowed?: boolean;
  revaluationModel?: string;
  groupingPolicy?: string;
  defaultExpenseType?: string;
  defaultDepreciationStartRule?: string | null;
  defaultPartialPeriodRule?: string | null;
  active?: boolean;
}

/**
 * Fixed-asset configuration (spec sections 7, 14, 20, 78-79, 99): asset
 * categories, effective-dated capitalization/depreciation policies and the
 * location catalog. Editing a category never touches existing assets — the
 * values were frozen onto each asset's own book policy at commissioning.
 */
@Injectable()
export class FixedAssetSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly strategies: DepreciationStrategyRegistry,
  ) {}

  private validateCategory(dto: Partial<CategoryInput>) {
    if (dto.defaultDepreciationMethod && !this.strategies.supported().includes(dto.defaultDepreciationMethod)) {
      throw new ValidationAppError(`Depreciation method ${dto.defaultDepreciationMethod} is not supported; supported: ${this.strategies.supported().join(', ')}`);
    }
    if (dto.defaultDepreciationStartRule && !Object.values(DepreciationStartRule).includes(dto.defaultDepreciationStartRule as any)) throw new ValidationAppError(`Unknown depreciation start rule ${dto.defaultDepreciationStartRule}`);
    if (dto.defaultPartialPeriodRule && !Object.values(PartialPeriodRule).includes(dto.defaultPartialPeriodRule as any)) throw new ValidationAppError(`Unknown partial-period rule ${dto.defaultPartialPeriodRule}`);
    if (dto.revaluationModel && !['COST_MODEL', 'REVALUATION_MODEL'].includes(dto.revaluationModel)) throw new ValidationAppError(`Unknown revaluation model ${dto.revaluationModel}`);
    if (dto.groupingPolicy && !['INDIVIDUAL_ASSET', 'GROUP_ASSET', 'COMPONENT_ASSET'].includes(dto.groupingPolicy)) throw new ValidationAppError(`Unknown grouping policy ${dto.groupingPolicy}`);
  }

  listCategories(tenantId: string) {
    return this.prisma.fixedAssetCategory.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async createCategory(tenantId: string, userId: string, dto: CategoryInput) {
    this.validateCategory(dto);
    const dup = await this.prisma.fixedAssetCategory.findFirst({ where: { tenantId, code: dto.code } });
    if (dup) throw new ConflictAppError(`Fixed asset category ${dto.code} already exists`);
    const row = await this.prisma.fixedAssetCategory.create({
      data: {
        tenantId,
        organizationId: dto.organizationId ?? null,
        code: dto.code,
        name: dto.name,
        defaultUsefulLifeMonths: dto.defaultUsefulLifeMonths ?? null,
        defaultDepreciationMethod: dto.defaultDepreciationMethod ?? 'STRAIGHT_LINE',
        defaultResidualValue: String(dto.defaultResidualValue ?? 0),
        defaultResidualPercent: dto.defaultResidualPercent !== undefined && dto.defaultResidualPercent !== null ? String(dto.defaultResidualPercent) : null,
        capitalizationThreshold: dto.capitalizationThreshold !== undefined && dto.capitalizationThreshold !== null ? String(dto.capitalizationThreshold) : null,
        accountingMappingProfile: dto.accountingMappingProfile ?? null,
        taxCategory: dto.taxCategory ?? null,
        componentizationAllowed: dto.componentizationAllowed ?? false,
        revaluationModel: dto.revaluationModel ?? 'COST_MODEL',
        groupingPolicy: dto.groupingPolicy ?? 'INDIVIDUAL_ASSET',
        defaultExpenseType: dto.defaultExpenseType ?? 'ADMINISTRATIVE',
        defaultDepreciationStartRule: dto.defaultDepreciationStartRule ?? null,
        defaultPartialPeriodRule: dto.defaultPartialPeriodRule ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_CATEGORY_CREATED', entityType: 'FixedAssetCategory', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async updateCategory(tenantId: string, id: string, userId: string, dto: Partial<CategoryInput> & { expectedVersion: number }) {
    this.validateCategory(dto);
    const existing = await this.prisma.fixedAssetCategory.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundAppError('FixedAssetCategory', id);
    const { expectedVersion, ...patch } = dto;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      data[k] = typeof v === 'number' && ['defaultResidualValue', 'defaultResidualPercent', 'capitalizationThreshold'].includes(k) ? String(v) : v;
    }
    const res = await this.prisma.fixedAssetCategory.updateMany({ where: { id, tenantId, version: expectedVersion }, data: { ...data, updatedBy: userId, version: { increment: 1 } } });
    if (res.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_CATEGORY_UPDATED', entityType: 'FixedAssetCategory', entityId: id, action: 'UPDATE', userId, oldValues: existing, newValues: data });
    return this.prisma.fixedAssetCategory.findUniqueOrThrow({ where: { id } });
  }

  listPolicies(tenantId: string) {
    return this.prisma.fixedAssetPolicy.findMany({ where: { tenantId }, orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }] });
  }

  async createPolicy(
    tenantId: string,
    userId: string,
    dto: {
      organizationId?: string;
      categoryId?: string;
      bookCode?: string;
      validFrom: string;
      validTo?: string;
      minCapitalizationThreshold?: number;
      minUsefulLifeMonths?: number;
      nonCapitalizableCostComponents?: string[];
      depreciationStartRule?: string;
      partialPeriodRule?: string;
      roundingPrecision?: number;
      suspensionDepreciationPolicy?: string;
      heldForSaleDepreciates?: boolean;
      modernizationDepreciates?: boolean;
      transferExpenseRule?: string;
      impairmentReversalAllowed?: boolean;
      requirePriorPeriodDepreciationForDisposal?: boolean;
    },
  ) {
    if (dto.bookCode && !BOOK_CODES.includes(dto.bookCode as any)) throw new ValidationAppError(`Unknown book ${dto.bookCode}`);
    if (dto.depreciationStartRule && !Object.values(DepreciationStartRule).includes(dto.depreciationStartRule as any)) throw new ValidationAppError(`Unknown depreciation start rule ${dto.depreciationStartRule}`);
    if (dto.partialPeriodRule && !Object.values(PartialPeriodRule).includes(dto.partialPeriodRule as any)) throw new ValidationAppError(`Unknown partial-period rule ${dto.partialPeriodRule}`);
    if (dto.transferExpenseRule && !['PERIOD_END_ASSIGNMENT', 'PERIOD_START_ASSIGNMENT'].includes(dto.transferExpenseRule)) throw new ValidationAppError(`Unknown transfer expense rule ${dto.transferExpenseRule}`);
    if (dto.categoryId) {
      const c = await this.prisma.fixedAssetCategory.findFirst({ where: { id: dto.categoryId, tenantId } });
      if (!c) throw new NotFoundAppError('FixedAssetCategory', dto.categoryId);
    }
    if (dto.organizationId) {
      const o = await this.prisma.organization.findFirst({ where: { id: dto.organizationId, tenantId } });
      if (!o) throw new NotFoundAppError('Organization', dto.organizationId);
    }
    const row = await this.prisma.fixedAssetPolicy.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        categoryId: dto.categoryId,
        bookCode: dto.bookCode ?? 'ACCOUNTING_BOOK',
        validFrom: toDate(dto.validFrom),
        validTo: dto.validTo ? toDate(dto.validTo) : null,
        minCapitalizationThreshold: String(dto.minCapitalizationThreshold ?? 0),
        minUsefulLifeMonths: dto.minUsefulLifeMonths ?? 12,
        nonCapitalizableCostComponents: dto.nonCapitalizableCostComponents ?? ['TRAINING', 'REPAIR'],
        depreciationStartRule: dto.depreciationStartRule ?? 'FIRST_DAY_NEXT_MONTH',
        partialPeriodRule: dto.partialPeriodRule ?? 'FULL_MONTH',
        roundingPrecision: dto.roundingPrecision ?? 2,
        suspensionDepreciationPolicy: dto.suspensionDepreciationPolicy ?? 'PAUSE_DEPRECIATION',
        heldForSaleDepreciates: dto.heldForSaleDepreciates ?? false,
        modernizationDepreciates: dto.modernizationDepreciates ?? true,
        transferExpenseRule: dto.transferExpenseRule ?? 'PERIOD_END_ASSIGNMENT',
        impairmentReversalAllowed: dto.impairmentReversalAllowed ?? true,
        requirePriorPeriodDepreciationForDisposal: dto.requirePriorPeriodDepreciationForDisposal ?? true,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_POLICY_CREATED', entityType: 'FixedAssetPolicy', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async deactivatePolicy(tenantId: string, id: string, userId: string) {
    const p = await this.prisma.fixedAssetPolicy.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundAppError('FixedAssetPolicy', id);
    const row = await this.prisma.fixedAssetPolicy.update({ where: { id }, data: { active: false, version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_POLICY_DEACTIVATED', entityType: 'FixedAssetPolicy', entityId: id, action: 'DEACTIVATE', userId });
    return row;
  }

  async listLocations(tenantId: string, membershipId: string, organizationId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetLocation.findMany({ where: { tenantId, organizationId }, orderBy: { code: 'asc' } });
  }

  async createLocation(tenantId: string, membershipId: string, organizationId: string, dto: { code: string; name: string; address?: string; branchId?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const dup = await this.prisma.fixedAssetLocation.findFirst({ where: { tenantId, organizationId, code: dto.code } });
    if (dup) throw new ConflictAppError(`Location ${dto.code} already exists`);
    if (dto.branchId) {
      const b = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId, organizationId } });
      if (!b) throw new NotFoundAppError('Branch', dto.branchId);
    }
    return this.prisma.fixedAssetLocation.create({ data: { tenantId, organizationId, code: dto.code, name: dto.name, address: dto.address, branchId: dto.branchId } });
  }

  supportedMethods() {
    return this.strategies.supported();
  }
}
