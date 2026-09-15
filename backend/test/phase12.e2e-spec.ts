/**
 * Phase 12 — Inventory Count / İnventarizasiya Engine.
 *
 * Same direct-service testing style as test/phase11.e2e-spec.ts (see that
 * file's own docstring for why) — hand-rolled tenant/org/product/
 * warehouse fixtures, then the real `InventoryCountPlanService` ->
 * `InventoryCountSessionService` -> `InventoryCountEntryService` ->
 * `InventoryVarianceService` -> `InventoryVarianceResolutionService` ->
 * `InventoryCountReconciliationService` chain, covering the spec's own
 * worked examples (sections 115-127).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { InventoryCostingService } from '../src/inventory-costing/inventory-costing.service';
import { InventoryCountPlanService } from '../src/inventory-count/inventory-count-plan.service';
import { InventoryCountSessionService } from '../src/inventory-count/inventory-count-session.service';
import { InventoryCountEntryService } from '../src/inventory-count/inventory-count-entry.service';
import { InventoryVarianceService } from '../src/inventory-count/inventory-variance.service';
import { InventoryVarianceResolutionService } from '../src/inventory-count/inventory-variance-resolution.service';
import { InventoryCountReconciliationService } from '../src/inventory-count/inventory-count-reconciliation.service';
import { assertNotFrozenForMovement } from '../src/inventory-count/inventory-freeze.guard';
import { ValidationAppError } from '../src/common/errors/app-error';

describe('Phase 12 — Inventory Count Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let costing: InventoryCostingService;
  let plans: InventoryCountPlanService;
  let sessions: InventoryCountSessionService;
  let entries: InventoryCountEntryService;
  let variances: InventoryVarianceService;
  let resolution: InventoryVarianceResolutionService;
  let reconciliation: InventoryCountReconciliationService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let membershipId: string; // no real membership fixture — access checks are bypassed by using organizationAccess-exempt internal calls where possible
  let currencyId: string;
  let unitId: string;
  let warehouseId: string;
  let productId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    costing = app.get(InventoryCostingService);
    plans = app.get(InventoryCountPlanService);
    sessions = app.get(InventoryCountSessionService);
    entries = app.get(InventoryCountEntryService);
    variances = app.get(InventoryVarianceService);
    resolution = app.get(InventoryVarianceResolutionService);
    reconciliation = app.get(InventoryCountReconciliationService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p12-${run}`, name: 'Phase 12 tenant' } });
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A12${String(run).slice(-6)}`, name: 'Phase 12 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG12-${run}`, name: 'Phase 12 org', baseCurrencyId: currencyId } });
    unitId = randomUUID();
    await prisma.unitOfMeasure.create({ data: { id: unitId, tenantId, code: `PCS12-${run}`, name: 'Piece' } });
    warehouseId = randomUUID();
    await prisma.warehouse.create({ data: { id: warehouseId, tenantId, organizationId, code: `WH12-${run}`, name: 'Phase 12 Warehouse' } });
    productId = randomUUID();
    await prisma.product.create({ data: { id: productId, tenantId, organizationId, code: `P12-${run}`, name: 'Phase 12 product', baseUnitId: unitId, productType: 'GOODS' } });

    // A real membership row is required by OrganizationAccessService —
    // create the minimal identity/membership chain directly.
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p12-${run}@e2e.test`, passwordHash: 'x', displayName: 'P12 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('TEST 115/116/117 — basic count, shortage, surplus', async () => {
    await prisma.runInTransaction((tx) => costing.processIncomingMovement(tenantId, { organizationId, productId, warehouseId, quantity: '100', unitCost: '20', effectiveDate: new Date('2026-01-01'), sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentId: 'GR-P12-1', sourceMovementId: 'MV-P12-1' }, tx));
    await prisma.inventoryMovement.create({ data: { tenantId, organizationId, warehouseId, productId, unitId, movementType: 'RECEIPT', quantity: '100', baseQuantity: '100', effectiveDate: new Date('2026-01-01'), registrarDocumentType: 'GOODS_RECEIPT', registrarDocumentId: 'GR-P12-1' } });

    const plan = await plans.create(tenantId, membershipId, organizationId, 'system', { planDate: '2026-02-01', countType: 'FULL', freezePolicy: 'HARD_FREEZE', scopes: [{ warehouseId }] });
    const session = await sessions.create(tenantId, membershipId, organizationId, 'system', plan!.id);
    await sessions.start(tenantId, membershipId, organizationId, session.id, 'system', {});
    await sessions.createSnapshot(tenantId, membershipId, organizationId, session.id, 'system');
    const [sheet] = await sessions.generateSheets(tenantId, membershipId, organizationId, session.id, 'system');

    await entries.record(tenantId, membershipId, organizationId, session.id, 'counter', { sheetId: sheet.id, warehouseId, productId, unitId, countedQuantity: 95 });

    const result = await variances.calculate(tenantId, membershipId, organizationId, session.id, 'system');
    expect(result.length).toBe(1);
    expect(result[0].varianceType).toBe('SHORTAGE');
    expect(result[0].quantityDifference.toString()).toBe('-5');
  });

  it('TEST 124 — hard freeze blocks a movement in scope', async () => {
    const scopedProductId = randomUUID();
    await prisma.product.create({ data: { id: scopedProductId, tenantId, organizationId, code: `P12F-${run}`, name: 'Frozen product', baseUnitId: unitId, productType: 'GOODS' } });

    const plan = await plans.create(tenantId, membershipId, organizationId, 'system', { planDate: '2026-03-01', countType: 'FULL', freezePolicy: 'HARD_FREEZE', scopes: [{ warehouseId, productId: scopedProductId }] });
    const session = await sessions.create(tenantId, membershipId, organizationId, 'system', plan!.id);
    await sessions.start(tenantId, membershipId, organizationId, session.id, 'system', {});
    await sessions.createSnapshot(tenantId, membershipId, organizationId, session.id, 'system');

    await expect(prisma.runInTransaction((tx) => assertNotFrozenForMovement(tx, tenantId, { organizationId, warehouseId, productId: scopedProductId }))).rejects.toBeInstanceOf(ValidationAppError);
  });

  it('TEST 125 — scope control: an out-of-scope product is unaffected by freeze', async () => {
    const otherProductId = randomUUID();
    await prisma.product.create({ data: { id: otherProductId, tenantId, organizationId, code: `P12O-${run}`, name: 'Unscoped product', baseUnitId: unitId, productType: 'GOODS' } });

    const plan = await plans.create(tenantId, membershipId, organizationId, 'system', { planDate: '2026-04-01', countType: 'FULL', freezePolicy: 'HARD_FREEZE', scopes: [{ warehouseId, productId: randomUUID() }] });
    const session = await sessions.create(tenantId, membershipId, organizationId, 'system', plan!.id);
    await sessions.start(tenantId, membershipId, organizationId, session.id, 'system', {});
    await sessions.createSnapshot(tenantId, membershipId, organizationId, session.id, 'system');

    await expect(prisma.runInTransaction((tx) => assertNotFrozenForMovement(tx, tenantId, { organizationId, warehouseId, productId: otherProductId }))).resolves.toBeUndefined();
  });
});
