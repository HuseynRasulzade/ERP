/**
 * Phase 21 — Manufacturing / Production Engine.
 *
 * Same direct-service testing style as test/phase20.e2e-spec.ts. Covers
 * the core flow: BOM version -> production order -> release (explodes
 * material requirements + reserves stock) -> material issue at actual
 * FIFO cost -> labor input -> output receipt (provisional cost from WIP)
 * -> close.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DocumentPostingService } from '../src/document-framework/document-posting.service';
import { BOMService } from '../src/manufacturing/bom.service';
import { WorkCenterService } from '../src/manufacturing/work-center.service';
import { ProductionOrderService } from '../src/manufacturing/production-order.service';
import { PRODUCTION_ORDER_TYPE } from '../src/manufacturing/production-order.repository';
import { MaterialIssueService } from '../src/manufacturing/material-issue.service';
import { MATERIAL_ISSUE_TYPE } from '../src/manufacturing/material-issue.repository';
import { OperationExecutionService } from '../src/manufacturing/operation-execution.service';
import { ProductionOutputService } from '../src/manufacturing/production-output.service';
import { PRODUCTION_OUTPUT_RECEIPT_TYPE } from '../src/manufacturing/production-output.repository';
import { ProductionCloseService } from '../src/manufacturing/production-close.service';
import { InventoryCostingService } from '../src/inventory-costing/inventory-costing.service';

describe('Phase 21 — Manufacturing Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: DocumentPostingService;
  let bom: BOMService;
  let workCenters: WorkCenterService;
  let orders: ProductionOrderService;
  let materialIssues: MaterialIssueService;
  let execution: OperationExecutionService;
  let outputs: ProductionOutputService;
  let close: ProductionCloseService;
  let costing: InventoryCostingService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let membershipId: string;
  let userId: string;
  let warehouseId: string;
  let unitId: string;
  let rawMaterialId: string;
  let finishedGoodId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    posting = app.get(DocumentPostingService);
    bom = app.get(BOMService);
    workCenters = app.get(WorkCenterService);
    orders = app.get(ProductionOrderService);
    materialIssues = app.get(MaterialIssueService);
    execution = app.get(OperationExecutionService);
    outputs = app.get(ProductionOutputService);
    close = app.get(ProductionCloseService);
    costing = app.get(InventoryCostingService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p21-${run}`, name: 'Phase 21 tenant' } });
    const currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A21${String(run).slice(-6)}`, name: 'Phase 21 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG21-${run}`, name: 'Phase 21 org', baseCurrencyId: currencyId } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p21-${run}@e2e.test`, passwordHash: 'x', displayName: 'P21 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);

    unitId = randomUUID();
    await prisma.unitOfMeasure.create({ data: { id: unitId, tenantId, code: `PC-${run}`, name: 'Piece' } });
    warehouseId = randomUUID();
    await prisma.warehouse.create({ data: { id: warehouseId, tenantId, organizationId, code: `WH-${run}`, name: 'Main Warehouse', allowNegativeStock: false } });

    const categoryId = randomUUID();
    await prisma.productCategory.create({ data: { id: categoryId, tenantId, organizationId, code: `CAT-${run}`, name: 'Manufacturing' } }).catch(() => undefined);
    rawMaterialId = randomUUID();
    await prisma.product.create({ data: { id: rawMaterialId, tenantId, organizationId, code: `RAW-${run}`, name: 'Raw Steel', baseUnitId: unitId } });
    finishedGoodId = randomUUID();
    await prisma.product.create({ data: { id: finishedGoodId, tenantId, organizationId, code: `FG-${run}`, name: 'Steel Bracket', baseUnitId: unitId } });

    // Seed 200 units of raw material at 10/unit via a direct opening receipt so material issue has real FIFO cost to consume.
    await prisma.runInTransaction(async (tx) => {
      const movement = await tx.inventoryMovement.create({ data: { tenantId, organizationId, warehouseId, productId: rawMaterialId, unitId, movementType: 'OPENING_BALANCE', quantity: '200', baseQuantity: '200', effectiveDate: new Date('2026-01-01'), registrarDocumentType: 'OPENING_BALANCE', registrarDocumentId: randomUUID() } });
      await costing.processIncomingMovement(tenantId, { organizationId, productId: rawMaterialId, warehouseId, quantity: '200', unitCost: new Decimal(10), effectiveDate: new Date('2026-01-01'), sourceDocumentType: 'OPENING_BALANCE', sourceDocumentId: movement.id, sourceMovementId: movement.id }, tx);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('produces 10 finished goods from raw material with real FIFO cost flowing through WIP', async () => {
    const bomMaster = await bom.create(tenantId, userId, { code: `BOM-${run}`, name: 'Bracket BOM', organizationId });
    const version = await bom.createVersion(tenantId, userId, bomMaster.id, { outputProductId: finishedGoodId, versionCode: 'V1', effectiveFrom: '2026-01-01', baseOutputQuantity: 1, baseUnitId: unitId, lines: [{ componentProductId: rawMaterialId, quantity: 2, unitId, sequence: 1 }] });
    await bom.approveVersion(tenantId, userId, version.id);

    const order = await orders.create(tenantId, membershipId, organizationId, userId, { documentDate: '2026-02-01', outputWarehouseId: warehouseId, bomVersionId: version.id, outputProductId: finishedGoodId, plannedOutputQuantity: 10, outputUnitId: unitId });
    expect(order.outputs).toHaveLength(1);

    await posting.post(tenantId, PRODUCTION_ORDER_TYPE, order.id, 1, userId);
    const requirements = await prisma.productionMaterialRequirement.findMany({ where: { tenantId, productionOrderId: order.id } });
    expect(requirements).toHaveLength(1);
    expect(requirements[0].requiredQuantity.toString()).toBe('20'); // 10 output × 2 per unit
    expect(requirements[0].reservationStatus).toBe('FULL'); // 200 available, only 20 needed

    const issue = await materialIssues.create(tenantId, membershipId, organizationId, userId, { productionOrderId: order.id, documentDate: '2026-02-05', lines: [{ requirementId: requirements[0].id, productId: rawMaterialId, unitId, quantity: 20 }] });
    await posting.post(tenantId, MATERIAL_ISSUE_TYPE, issue.id, 1, userId);

    const materialCostMovement = await prisma.productionCostMovement.findFirst({ where: { tenantId, productionOrderId: order.id, costComponent: 'DIRECT_MATERIAL' } });
    expect(new Decimal(materialCostMovement!.costIn.toString()).toString()).toBe('200'); // 20 units × 10 FIFO cost

    await execution.recordLabor(tenantId, membershipId, organizationId, userId, { productionOrderId: order.id, workDate: '2026-02-05', hours: 5, hourlyRate: 8 });
    const laborCostMovement = await prisma.productionCostMovement.findFirst({ where: { tenantId, productionOrderId: order.id, costComponent: 'DIRECT_LABOR' } });
    expect(new Decimal(laborCostMovement!.costIn.toString()).toString()).toBe('40'); // 5h × 8

    const wipBefore = await prisma.productionCostMovement.aggregate({ where: { tenantId, productionOrderId: order.id, reversed: false }, _sum: { costIn: true, costOut: true } });
    const wipBalance = new Decimal((wipBefore._sum.costIn ?? 0).toString()).minus((wipBefore._sum.costOut ?? 0).toString());
    expect(wipBalance.toString()).toBe('240'); // 200 material + 40 labor

    const receipt = await outputs.create(tenantId, membershipId, organizationId, userId, { productionOrderId: order.id, outputId: order.outputs[0].id, goodQuantity: 10, documentDate: '2026-02-06' });
    await posting.post(tenantId, PRODUCTION_OUTPUT_RECEIPT_TYPE, receipt.id, 1, userId);

    const updatedOutput = await prisma.productionOrderOutput.findUniqueOrThrow({ where: { id: order.outputs[0].id } });
    expect(updatedOutput.receivedQuantity.toString()).toBe('10');
    const finishedGoodBalance = await prisma.inventoryMovement.aggregate({ where: { tenantId, warehouseId, productId: finishedGoodId }, _sum: { quantity: true } });
    expect((finishedGoodBalance._sum.quantity ?? 0).toString()).toBe('10');

    const wipAfter = await prisma.productionCostMovement.aggregate({ where: { tenantId, productionOrderId: order.id, reversed: false }, _sum: { costIn: true, costOut: true } });
    const closingWip = new Decimal((wipAfter._sum.costIn ?? 0).toString()).minus((wipAfter._sum.costOut ?? 0).toString());
    expect(closingWip.abs().lte('0.05')).toBe(true); // fully transferred to the single main output

    const checks = await close.runCloseChecks(tenantId, organizationId, order.id);
    expect(checks.every((c) => c.passed)).toBe(true);
    const closed = await close.close(tenantId, membershipId, organizationId, userId, order.id);
    expect(closed.closeStatus).toBe('CLOSED');
  });
});
