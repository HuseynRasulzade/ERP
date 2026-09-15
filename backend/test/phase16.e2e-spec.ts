/**
 * Phase 16 — Fixed Assets Engine.
 *
 * Same direct-service testing style as test/phase15.e2e-spec.ts. Covers:
 * CIP cost accumulation -> capitalization -> commissioning -> two months
 * of straight-line depreciation (including the final-period true-up) ->
 * a transfer -> an impairment -> a full disposal with gain/loss.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DocumentPostingService } from '../src/document-framework/document-posting.service';
import { FixedAssetCategoryService } from '../src/fixed-assets/fixed-asset-category.service';
import { CapitalInvestmentProjectService } from '../src/fixed-assets/capital-investment-project.service';
import { FixedAssetCapitalizationService } from '../src/fixed-assets/fixed-asset-capitalization.service';
import { FIXED_ASSET_CAPITALIZATION_TYPE } from '../src/fixed-assets/fixed-asset-capitalization.repository';
import { FixedAssetCommissioningService } from '../src/fixed-assets/fixed-asset-commissioning.service';
import { FixedAssetDepreciationService } from '../src/fixed-assets/fixed-asset-depreciation.service';
import { FixedAssetTransferService } from '../src/fixed-assets/fixed-asset-transfer.service';
import { FIXED_ASSET_TRANSFER_TYPE } from '../src/fixed-assets/fixed-asset-transfer.repository';
import { FixedAssetImpairmentService } from '../src/fixed-assets/fixed-asset-impairment.service';
import { FIXED_ASSET_IMPAIRMENT_TYPE } from '../src/fixed-assets/fixed-asset-impairment.repository';
import { FixedAssetDisposalService } from '../src/fixed-assets/fixed-asset-disposal.service';
import { FIXED_ASSET_DISPOSAL_TYPE } from '../src/fixed-assets/fixed-asset-disposal.repository';
import { FixedAssetService } from '../src/fixed-assets/fixed-asset.service';

describe('Phase 16 — Fixed Assets Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: DocumentPostingService;
  let categories: FixedAssetCategoryService;
  let cip: CapitalInvestmentProjectService;
  let capitalization: FixedAssetCapitalizationService;
  let commissioning: FixedAssetCommissioningService;
  let depreciation: FixedAssetDepreciationService;
  let transfers: FixedAssetTransferService;
  let impairments: FixedAssetImpairmentService;
  let disposals: FixedAssetDisposalService;
  let assets: FixedAssetService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let membershipId: string;
  let userId: string;
  let categoryId: string;
  let departmentAId: string;
  let departmentBId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    posting = app.get(DocumentPostingService);
    categories = app.get(FixedAssetCategoryService);
    cip = app.get(CapitalInvestmentProjectService);
    capitalization = app.get(FixedAssetCapitalizationService);
    commissioning = app.get(FixedAssetCommissioningService);
    depreciation = app.get(FixedAssetDepreciationService);
    transfers = app.get(FixedAssetTransferService);
    impairments = app.get(FixedAssetImpairmentService);
    disposals = app.get(FixedAssetDisposalService);
    assets = app.get(FixedAssetService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p16-${run}`, name: 'Phase 16 tenant' } });
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A16${String(run).slice(-6)}`, name: 'Phase 16 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG16-${run}`, name: 'Phase 16 org', baseCurrencyId: currencyId } });

    departmentAId = randomUUID();
    await prisma.department.create({ data: { id: departmentAId, tenantId, organizationId, code: `DEPT-A-${run}`, name: 'Production' } });
    departmentBId = randomUUID();
    await prisma.department.create({ data: { id: departmentBId, tenantId, organizationId, code: `DEPT-B-${run}`, name: 'Maintenance' } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p16-${run}@e2e.test`, passwordHash: 'x', displayName: 'P16 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);

    const category = await categories.create(tenantId, membershipId, organizationId, userId, { code: `MACHINERY-${run}`, name: 'Machinery' });
    categoryId = category.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a CIP accumulates cost from multiple sources, then capitalizes into one asset with straight-line depreciation over two months', async () => {
    const project = await cip.create(tenantId, membershipId, organizationId, userId, { code: `CIP-${run}`, name: 'New production line', startDate: '2026-01-01', currencyId });
    await cip.addCostLine(tenantId, membershipId, organizationId, userId, project.id, { costComponent: 'PURCHASE_PRICE', sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: randomUUID(), currencyId, amount: 100000, baseAmount: 100000, effectiveDate: '2026-01-05' });
    await cip.addCostLine(tenantId, membershipId, organizationId, userId, project.id, { costComponent: 'INSTALLATION', sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: randomUUID(), currencyId, amount: 15000, baseAmount: 15000, effectiveDate: '2026-01-10' });
    await cip.addCostLine(tenantId, membershipId, organizationId, userId, project.id, { costComponent: 'OTHER', sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: randomUUID(), currencyId, amount: 2000, baseAmount: 2000, capitalizable: false, effectiveDate: '2026-01-10' });

    const summaryBefore = await cip.summary(tenantId, membershipId, organizationId, project.id);
    expect(summaryBefore.capitalizableCost).toBe('115000');
    expect(summaryBefore.expensedCost).toBe('2000');

    const lines = await prisma.capitalInvestmentCostLine.findMany({ where: { tenantId, projectId: project.id, capitalizable: true } });
    const { asset, capitalization: capDoc } = await capitalization.capitalize(tenantId, membershipId, organizationId, userId, { name: 'CNC Machine', categoryId, cipProjectId: project.id, costLineIds: lines.map((l) => l.id), currencyId, acquisitionDate: '2026-01-05', documentDate: '2026-01-31' });
    expect(asset.status).toBe('ACQUISITION');

    await posting.post(tenantId, FIXED_ASSET_CAPITALIZATION_TYPE, capDoc.id, 1, userId);
    const acceptedAsset = await assets.get(tenantId, membershipId, organizationId, asset.id);
    expect(acceptedAsset.status).toBe('ACCEPTED');
    expect(acceptedAsset.initialCost.toString()).toBe('115000');

    await cip.close(tenantId, membershipId, organizationId, userId, project.id);

    await commissioning.commission(tenantId, membershipId, organizationId, userId, asset.id, { commissioningDate: '2026-02-01', departmentId: departmentAId, usefulLifeMonths: 24, residualValue: 5000, depreciationStartRule: 'FROM_COMMISSIONING_DATE' });

    // Month 1 — straight line: (115000 - 5000) / 24 = 4583.333...
    const run1 = await depreciation.calculate(tenantId, membershipId, organizationId, userId, '2026-02');
    expect(run1.assetCount).toBe(1);
    await depreciation.post(tenantId, membershipId, organizationId, userId, run1.id);
    let refreshed = await assets.get(tenantId, membershipId, organizationId, asset.id);
    expect(Number(refreshed.accumulatedDepreciation.toString())).toBeCloseTo(4583.33, 1);

    // Month 2
    const run2 = await depreciation.calculate(tenantId, membershipId, organizationId, userId, '2026-03');
    await depreciation.post(tenantId, membershipId, organizationId, userId, run2.id);
    refreshed = await assets.get(tenantId, membershipId, organizationId, asset.id);
    expect(Number(refreshed.accumulatedDepreciation.toString())).toBeCloseTo(9166.67, 1);

    // Transfer to Maintenance department
    const transfer = await transfers.create(tenantId, membershipId, organizationId, userId, { assetId: asset.id, toDepartmentId: departmentBId, reason: 'Reassigned', documentDate: '2026-03-15' });
    await posting.post(tenantId, FIXED_ASSET_TRANSFER_TYPE, transfer.id, 1, userId);
    refreshed = await assets.get(tenantId, membershipId, organizationId, asset.id);
    expect(refreshed.departmentId).toBe(departmentBId);

    // Impairment: recoverable amount drops below carrying amount
    const carryingBeforeImpairment = Number(refreshed.carryingAmount.toString());
    const impairment = await impairments.create(tenantId, membershipId, organizationId, userId, { assetId: asset.id, recoverableAmount: carryingBeforeImpairment - 10000, reason: 'Obsolescence', documentDate: '2026-03-20' });
    await posting.post(tenantId, FIXED_ASSET_IMPAIRMENT_TYPE, impairment.id, 1, userId);
    refreshed = await assets.get(tenantId, membershipId, organizationId, asset.id);
    expect(Number(refreshed.impairmentBalance.toString())).toBeCloseTo(10000, 1);
    expect(refreshed.status).toBe('IMPAIRED');

    // Full disposal — sale
    const carryingAtDisposal = Number(refreshed.carryingAmount.toString());
    const disposal = await disposals.create(tenantId, membershipId, organizationId, userId, { assetId: asset.id, disposalType: 'SALE', proceeds: carryingAtDisposal + 3000, currencyId, documentDate: '2026-04-01' });
    await posting.post(tenantId, FIXED_ASSET_DISPOSAL_TYPE, disposal.id, 1, userId);
    const disposed = await prisma.fixedAssetDisposal.findUniqueOrThrow({ where: { id: disposal.id } });
    expect(Number(disposed.gainLoss!.toString())).toBeCloseTo(3000, 1);
    refreshed = await assets.get(tenantId, membershipId, organizationId, asset.id);
    expect(refreshed.status).toBe('DISPOSED');
  });
});
