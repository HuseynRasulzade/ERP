/**
 * Phase 24 — Management Reporting / KPI Engine / Profitability Engine /
 * Budget-Forecast-Scenario / Dashboard Platform.
 *
 * Direct-service testing style matching phases 15-23's own test files.
 * Builds a minimal sales + inventory-costing fixture (matching the
 * pattern established in test/phase21.e2e-spec.ts) so canonical
 * measures (GROSS_REVENUE/COGS/GROSS_PROFIT/AR_BALANCE/INVENTORY_VALUE)
 * resolve to real, checkable numbers, then exercises the semantic
 * model, KPI evaluation, working-capital KPIs, management allocation,
 * budget variance, forecast latest-estimate, scenario what-if, and a
 * frozen snapshot.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { InventoryCostingService } from '../src/inventory-costing/inventory-costing.service';
import { ManagementMeasureService } from '../src/management-reporting/management-measure.service';
import { ManagementSemanticModelService } from '../src/management-reporting/management-semantic-model.service';
import { KPIService } from '../src/management-reporting/kpi.service';
import { WorkingCapitalAnalyticsService } from '../src/management-reporting/working-capital-kpi.service';
import { ManagementAllocationService } from '../src/management-reporting/management-allocation.service';
import { ProfitabilityService } from '../src/management-reporting/profitability.service';
import { BudgetService } from '../src/management-reporting/budget.service';
import { VarianceAnalysisService } from '../src/management-reporting/variance-analysis.service';
import { ForecastService } from '../src/management-reporting/forecast.service';
import { ScenarioService } from '../src/management-reporting/scenario.service';
import { ManagementSnapshotService } from '../src/management-reporting/management-snapshot.service';

describe('Phase 24 — Management Reporting Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let costing: InventoryCostingService;
  let measures: ManagementMeasureService;
  let semanticModel: ManagementSemanticModelService;
  let kpi: KPIService;
  let workingCapital: WorkingCapitalAnalyticsService;
  let allocation: ManagementAllocationService;
  let profitability: ProfitabilityService;
  let budget: BudgetService;
  let variance: VarianceAnalysisService;
  let forecast: ForecastService;
  let scenario: ScenarioService;
  let snapshots: ManagementSnapshotService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let userId: string;
  let warehouseId: string;
  let unitId: string;
  let productId: string;
  let customerId: string;
  let semanticModelVersionId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    costing = app.get(InventoryCostingService);
    measures = app.get(ManagementMeasureService);
    semanticModel = app.get(ManagementSemanticModelService);
    kpi = app.get(KPIService);
    workingCapital = app.get(WorkingCapitalAnalyticsService);
    allocation = app.get(ManagementAllocationService);
    profitability = app.get(ProfitabilityService);
    budget = app.get(BudgetService);
    variance = app.get(VarianceAnalysisService);
    forecast = app.get(ForecastService);
    scenario = app.get(ScenarioService);
    snapshots = app.get(ManagementSnapshotService);

    tenantId = randomUUID();
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A24${String(run).slice(-6)}`, name: 'Phase 24 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.create({ data: { id: tenantId, code: `p24-${run}`, name: 'Phase 24 tenant', baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG24-${run}`, name: 'Phase 24 org', baseCurrencyId: currencyId } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p24-${run}@e2e.test`, passwordHash: 'x', displayName: 'P24 User' } });

    unitId = randomUUID();
    await prisma.unitOfMeasure.create({ data: { id: unitId, tenantId, code: `PC24-${run}`, name: 'Piece' } });
    warehouseId = randomUUID();
    await prisma.warehouse.create({ data: { id: warehouseId, tenantId, organizationId, code: `WH24-${run}`, name: 'Main Warehouse', allowNegativeStock: false } });
    productId = randomUUID();
    await prisma.product.create({ data: { id: productId, tenantId, organizationId, code: `SKU24-${run}`, name: 'Widget', baseUnitId: unitId } });
    customerId = randomUUID();
    await prisma.counterparty.create({ data: { id: customerId, tenantId, organizationId, counterpartyType: 'CUSTOMER', code: `CUST24-${run}`, name: 'Acme Corp' } });

    // Seed 100 units at 10/unit (cost of goods available for sale).
    await prisma.runInTransaction(async (tx) => {
      const movement = await tx.inventoryMovement.create({ data: { tenantId, organizationId, warehouseId, productId, unitId, movementType: 'OPENING_BALANCE', quantity: '100', baseQuantity: '100', effectiveDate: new Date('2026-01-01'), registrarDocumentType: 'OPENING_BALANCE', registrarDocumentId: randomUUID() } });
      await costing.processIncomingMovement(tenantId, { organizationId, productId, warehouseId, quantity: '100', unitCost: new Decimal(10), effectiveDate: new Date('2026-01-01'), sourceDocumentType: 'OPENING_BALANCE', sourceDocumentId: movement.id, sourceMovementId: movement.id }, tx);
    });

    // Sell 40 units at 25/unit in February, and record the FIFO cost consumption.
    const invoiceId = randomUUID();
    await prisma.salesInvoice.create({ data: { id: invoiceId, tenantId, organizationId, counterpartyId: customerId, documentDate: new Date('2026-02-15'), status: 'ACTIVE', postingStatus: 'POSTED', subtotal: '1000', grandTotal: '1000' } });
    const lineId = randomUUID();
    await prisma.salesInvoiceLine.create({ data: { id: lineId, tenantId, salesInvoiceId: invoiceId, productId, unitId, quantity: '40', price: '25', lineTotal: '1000' } });
    await prisma.runInTransaction(async (tx) => {
      const outMovement = await tx.inventoryMovement.create({ data: { tenantId, organizationId, warehouseId, productId, unitId, movementType: 'SALES_SHIPMENT', quantity: '-40', baseQuantity: '-40', effectiveDate: new Date('2026-02-15'), registrarDocumentType: 'SALES_INVOICE', registrarDocumentId: invoiceId } });
      await costing.calculateOutgoingCost(tenantId, { organizationId, productId, warehouseId, quantity: new Decimal(40), effectiveDate: new Date('2026-02-15'), outgoingDocumentType: 'SALES_INVOICE', outgoingDocumentId: invoiceId, outgoingDocumentLineId: lineId, outgoingMovementId: outMovement.id }, tx);
    });

    // An open AR balance for the same customer.
    await prisma.settlementObligation.create({ data: { tenantId, organizationId, counterpartyId: customerId, sourceDocumentType: 'SALES_INVOICE', sourceDocumentId: invoiceId, currencyId, amountDue: '1000', baseCurrencyAmount: '1000', remainingAmount: '600', status: 'OPEN' } });

    const semanticModelRow = await semanticModel.createModel(tenantId, userId, { code: `SM-${run}`, name: 'Core Semantic Model' });
    const version = await semanticModel.createVersion(tenantId, userId, semanticModelRow.id, { effectiveFrom: '2026-01-01' });
    await semanticModel.createMeasure(tenantId, version.id, { code: 'CONTRIBUTION_MARGIN', name: 'Contribution Margin', sourceFact: 'DERIVED', aggregationType: 'FORMULA', formula: 'GROSS_PROFIT' });
    await semanticModel.activateVersion(tenantId, userId, version.id);
    semanticModelVersionId = version.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves canonical revenue/COGS/margin measures from real sales + costing data', async () => {
    const period = { type: 'PERIOD' as const, periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28') };
    const grossRevenue = await measures.evaluate(tenantId, organizationId, 'GROSS_REVENUE', period);
    expect(grossRevenue.value.toFixed(2)).toBe('1000.00');
    const cogs = await measures.evaluate(tenantId, organizationId, 'COGS', period);
    expect(cogs.value.toFixed(2)).toBe('400.00'); // 40 units × 10 FIFO cost
    expect(cogs.freshness).toBe('FINAL');
    const grossProfit = await measures.evaluate(tenantId, organizationId, 'GROSS_PROFIT', period);
    expect(grossProfit.value.toFixed(2)).toBe('600.00');
    const marginPct = await measures.evaluate(tenantId, organizationId, 'GROSS_MARGIN_PCT', period);
    expect(marginPct.value.toFixed(2)).toBe('60.00');

    // Zero-revenue period must not crash / return Infinity (spec section 209).
    const emptyPeriod = { type: 'PERIOD' as const, periodStart: new Date('2025-01-01'), periodEnd: new Date('2025-01-31') };
    const zeroMargin = await measures.evaluate(tenantId, organizationId, 'GROSS_MARGIN_PCT', emptyPeriod);
    expect(zeroMargin.value.toFixed(2)).toBe('0.00');
  });

  it('evaluates a FORMULA-defined semantic measure (Contribution Margin) via the shared formula engine', async () => {
    const period = { type: 'PERIOD' as const, periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28') };
    const contribution = await semanticModel.resolveMeasure(tenantId, organizationId, semanticModelVersionId, 'CONTRIBUTION_MARGIN', period);
    expect(contribution.value.toFixed(2)).toBe('600.00');
  });

  it('evaluates a KPI against its target with directionality-aware status', async () => {
    const kpiDef = await kpi.create(tenantId, semanticModelVersionId, { code: `GM-${run}`, name: 'Gross Margin %', numeratorMeasure: 'GROSS_PROFIT', denominatorMeasure: 'NET_REVENUE', unit: 'PERCENT', directionality: 'HIGHER_IS_BETTER', warningThreshold: 65, criticalThreshold: 50 });
    await kpi.setTarget(tenantId, kpiDef.id, { organizationId, period: '2026-02', target: 65 });
    const evaluation = await kpi.evaluate(tenantId, organizationId, kpiDef.code, { type: 'PERIOD', periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28') }, '2026-02');
    expect(evaluation.actual?.toFixed(2)).toBe('60.00');
    expect(evaluation.status).toBe('WARNING'); // below 65 warning threshold but above 50 critical
    expect(evaluation.variance?.toFixed(2)).toBe('-5.00');
  });

  it('computes working-capital KPIs (DSO/DIO/DPO/CCC) from real AR/inventory/COGS data', async () => {
    const result = await workingCapital.calculate(tenantId, organizationId, new Date('2026-02-01'), new Date('2026-02-28'));
    expect(result.arBalance).toBe('600.00');
    expect(result.inventoryValue).toBe('600.00'); // 60 units remaining × 10
    expect(Number(result.dso)).toBeGreaterThan(0);
    expect(Number(result.dio)).toBeGreaterThan(0);
  });

  it('runs a management-only allocation and overlays it onto customer profitability without touching GL', async () => {
    await allocation.createRule(tenantId, { code: `SVC-${run}`, name: 'Shared Service Allocation', sourceMeasure: 'SHARED_SERVICE_COST', targetDimension: 'CUSTOMER', driverMeasure: 'NET_REVENUE' });
    const { lines } = await allocation.run(tenantId, userId, `SVC-${run}`, organizationId, '2026-02', 100, [{ key: customerId, driverValue: 1000 }]);
    expect(lines).toHaveLength(1);
    expect(new Decimal(lines[0].allocatedAmount.toString()).toFixed(2)).toBe('100.00'); // sole target gets 100% of the pool

    const rows = await profitability.byCustomer(tenantId, organizationId, { type: 'PERIOD', periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28') }, `SVC-${run}`, '2026-02');
    const customerRow = rows.find((r) => r.key === customerId);
    expect(customerRow?.grossProfit).toBe('600.00');
    expect(customerRow?.allocatedCost).toBe('100.00');
    expect(customerRow?.contribution).toBe('500.00');
  });

  it('supports versioned budget facts with optimistic locking and Actual-vs-Budget variance', async () => {
    const version = await budget.createVersion(tenantId, userId, { organizationId, fiscalYear: 2026, baseCurrencyId: currencyId });
    await budget.upsertFact(tenantId, version.id, version.recordVersion, { period: '2026-02', measureCode: 'GROSS_REVENUE', amount: 900 });

    const staleVersion = { ...version };
    await expect(budget.upsertFact(tenantId, version.id, staleVersion.recordVersion, { period: '2026-02', measureCode: 'GROSS_REVENUE', amount: 950 })).rejects.toThrow(); // stale recordVersion

    const refreshed = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: version.id } });
    await budget.upsertFact(tenantId, version.id, refreshed.recordVersion, { period: '2026-02', measureCode: 'GROSS_REVENUE', amount: 950 });

    const result = await variance.actualVsBudget(tenantId, organizationId, version.id, '2026-02', 'GROSS_REVENUE', { type: 'PERIOD', periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28') });
    expect(result.actual).toBe('1000.00');
    expect(result.comparator).toBe('950.00');
    expect(result.favorability).toBe('FAVORABLE'); // actual revenue exceeds budget
  });

  it('never overwrites a prior forecast version and computes an Actual + Forecast latest estimate', async () => {
    const fc1 = await forecast.createVersion(tenantId, userId, { organizationId, fiscalYear: 2026, code: 'FC1' });
    await forecast.setFact(tenantId, fc1.id, { period: '2026-03', measureCode: 'GROSS_REVENUE', amount: 500 });
    const fc2 = await forecast.createVersion(tenantId, userId, { organizationId, fiscalYear: 2026, code: 'FC2' });
    await forecast.setFact(tenantId, fc2.id, { period: '2026-03', measureCode: 'GROSS_REVENUE', amount: 700 });

    const fc1Facts = await prisma.forecastFact.findMany({ where: { tenantId, forecastVersionId: fc1.id } });
    expect(fc1Facts).toHaveLength(1);
    expect(fc1Facts[0].amount.toString()).toBe('500'); // FC1 untouched by FC2

    const estimate = await forecast.latestEstimate(tenantId, organizationId, fc2.id, 2026, 'GROSS_REVENUE', 2);
    expect(estimate.actualToDate).toBe('1000.00'); // Jan-Feb actual (only Feb has data)
    expect(estimate.forecastRemaining).toBe('700.00'); // Mar-Dec forecast (only Mar has a fact)
    expect(estimate.latestEstimate).toBe('1700.00');
  });

  it('calculates a what-if scenario without mutating actual data', async () => {
    const scenarioRow = await scenario.create(tenantId, { code: `STRESS-${run}`, name: 'Stress Scenario', scenarioType: 'STRESS' });
    await scenario.addAssumption(tenantId, scenarioRow.id, { measureCode: 'GROSS_REVENUE', adjustmentType: 'PERCENT', adjustmentValue: -10 });

    const period = { type: 'PERIOD' as const, periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28') };
    const result = await scenario.calculate(tenantId, userId, `STRESS-${run}`, organizationId, period, '2026-02', 'GROSS_REVENUE');
    expect(result.baseValue.toString()).toBe('1000');
    expect(new Decimal(result.scenarioValue.toString()).toFixed(2)).toBe('900.00');

    // Actual measure remains untouched.
    const actualAfter = await measures.evaluate(tenantId, organizationId, 'GROSS_REVENUE', period);
    expect(actualAfter.value.toFixed(2)).toBe('1000.00');
  });

  it('freezes an immutable management snapshot with full source-version lineage', async () => {
    const snapshot = await snapshots.create(tenantId, userId, { organizationId, snapshotType: 'BOARD_PACK', period: '2026-02', semanticModelVersionId, payload: { grossRevenue: '1000.00', grossMarginPct: '60.00' } });
    expect(snapshot.status).toBe('FINAL');
    const fetched = await snapshots.get(tenantId, snapshot.id);
    expect((fetched.payload as { grossRevenue: string }).grossRevenue).toBe('1000.00');
  });
});
