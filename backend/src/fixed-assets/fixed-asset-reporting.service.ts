import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/** FixedAssetReportingService — read-only reports (spec sections 114-122). */
@Injectable()
export class FixedAssetReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** REPORT — Fixed Asset Register (spec section 114). */
  async register(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assets = await this.prisma.fixedAsset.findMany({ where: { organizationId }, include: { category: true, department: true, responsiblePerson: true } });
    return assets.map((a) => ({
      assetNumber: a.assetNumber,
      name: a.name,
      category: a.category.name,
      commissioningDate: a.commissioningDate,
      initialCost: a.initialCost.toString(),
      accumulatedDepreciation: a.accumulatedDepreciation.toString(),
      nbv: a.carryingAmount.toString(),
      department: a.department?.name ?? null,
      responsible: a.responsiblePerson?.displayName ?? null,
      status: a.status,
    }));
  }

  /** REPORT — Depreciation Schedule (spec section 115), from
   * `FixedAssetDepreciationEntry` (already immutable, authoritative). */
  async depreciationSchedule(tenantId: string, membershipId: string, organizationId: string, assetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const entries = await this.prisma.fixedAssetDepreciationEntry.findMany({ where: { tenantId, assetId }, include: { run: true }, orderBy: { run: { period: 'asc' } } });
    return entries.map((e) => ({ period: e.run.period, openingNbv: e.openingNbv.toString(), depreciation: e.depreciationAmount.toString(), closingNbv: e.closingNbv.toString(), posted: e.posted, errorCode: e.errorCode }));
  }

  /** REPORT — Fixed Asset Movements (spec section 116): opening/closing
   * cost roll-forward for a period, derived purely from
   * FixedAssetMovement. */
  async movementsReport(tenantId: string, membershipId: string, organizationId: string, periodStart: string, periodEnd: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const [before, during] = await Promise.all([
      this.prisma.fixedAssetMovement.findMany({ where: { tenantId, organizationId, valuationBook: 'ACCOUNTING_BOOK', reversed: false, effectiveDate: { lt: start } } }),
      this.prisma.fixedAssetMovement.findMany({ where: { tenantId, organizationId, valuationBook: 'ACCOUNTING_BOOK', reversed: false, effectiveDate: { gte: start, lte: end } } }),
    ]);
    const sum = (rows: typeof before, field: 'costIncrease' | 'costDecrease' | 'depreciationIncrease' | 'depreciationDecrease' | 'impairmentIncrease' | 'impairmentDecrease') => rows.reduce((s, r) => s.plus(r[field].toString()), new Decimal(0));
    const openingCost = sum(before, 'costIncrease').minus(sum(before, 'costDecrease'));
    const acquisitions = during.filter((m) => m.movementType === 'INITIAL_RECOGNITION').reduce((s, m) => s.plus(m.costIncrease.toString()), new Decimal(0));
    const capitalizedImprovements = during.filter((m) => m.movementType === 'MODERNIZATION').reduce((s, m) => s.plus(m.costIncrease.toString()), new Decimal(0));
    const transfersCost = during.filter((m) => m.movementType === 'TRANSFER').reduce((s, m) => s.plus(m.costIncrease.toString()).minus(m.costDecrease.toString()), new Decimal(0));
    const disposalsCost = during.filter((m) => ['FULL_DISPOSAL', 'PARTIAL_DISPOSAL', 'WRITE_OFF'].includes(m.movementType)).reduce((s, m) => s.plus(m.costDecrease.toString()), new Decimal(0));
    const closingCost = openingCost.plus(acquisitions).plus(capitalizedImprovements).plus(transfersCost).minus(disposalsCost);
    const depreciationMovement = sum(during, 'depreciationIncrease').minus(sum(during, 'depreciationDecrease'));
    const impairmentMovement = sum(during, 'impairmentIncrease').minus(sum(during, 'impairmentDecrease'));
    return { openingCost: openingCost.toString(), acquisitions: acquisitions.toString(), capitalizedImprovements: capitalizedImprovements.toString(), transfers: transfersCost.toString(), disposals: disposalsCost.toString(), closingCost: closingCost.toString(), depreciationMovement: depreciationMovement.toString(), impairmentMovement: impairmentMovement.toString() };
  }

  /** REPORT — Fully Depreciated Assets (spec section 118). */
  async fullyDepreciated(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assets = await this.prisma.fixedAsset.findMany({ where: { organizationId, status: { notIn: ['DISPOSED', 'WRITTEN_OFF'] } } });
    return assets.filter((a) => new Decimal(a.carryingAmount.toString()).lte(new Decimal(a.residualValue.toString()).plus('0.01')));
  }

  /** REPORT — Assets Not Commissioned (spec section 119). */
  async notCommissioned(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assets = await this.prisma.fixedAsset.findMany({ where: { organizationId, status: { in: ['ACCEPTED', 'NOT_COMMISSIONED'] } }, include: { department: true, responsiblePerson: true } });
    const now = Date.now();
    return assets.map((a) => ({ assetNumber: a.assetNumber, name: a.name, acquisitionDate: a.acquisitionDate, initialCost: a.initialCost.toString(), daysPending: a.acceptanceDate ? Math.floor((now - a.acceptanceDate.getTime()) / 86_400_000) : null, department: a.department?.name ?? null, responsible: a.responsiblePerson?.displayName ?? null }));
  }

  /** REPORT — Disposals (spec section 122). */
  async disposalsReport(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetDisposal.findMany({ where: { organizationId, postingStatus: 'POSTED' }, include: { asset: true }, orderBy: { documentDate: 'desc' } });
  }

  /** REPORT — Modernization (spec section 121). */
  async modernizationReport(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetModernization.findMany({ where: { organizationId, postingStatus: 'POSTED' }, include: { asset: true }, orderBy: { documentDate: 'desc' } });
  }
}
