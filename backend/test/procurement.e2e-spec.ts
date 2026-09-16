/**
 * Procurement & Purchase Order Management E2E tests (docx spec Phase 8).
 *
 * Covers: manual Purchase Requirement create/cancel, demand aggregation,
 * supplier eligibility (SUPPLIER role required), supplier product code +
 * candidate comparison, PurchaseOrder create/confirm with NO GL/AP/
 * TaxMovement consequence, expected supply computed from confirmed PO
 * lines and reduced by line cancellation, requirement-to-PurchaseOrder
 * multi-supplier partial allocation (PARTIALLY_ORDERED -> FULLY_ORDERED,
 * over-allocation rejected), purchase order hold blocking confirmation,
 * payment schedule generation with exact rounding, demand-supply pegging
 * against a SalesOrderLine with over-peg rejection, and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { PURCHASE_ORDER_TYPE } from '../src/procurement/purchase-order.repository';
import * as request from 'supertest';

describe('Procurement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let approverToken: string; // holds every approval-chain role, distinct from token1 (the creator)
  let approverMembershipId: string;
  let autoFillDepartmentId: string; // set once token1's own OrganizationAccess gets a department (see "auto-fills department" test)
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let productId: string;
  let unitId: string;
  let supplierId: string;
  let customerOnlyId: string; // ineligible as PO supplier
  let customerId: string; // for the SalesOrder demand side of pegging
  let warehouseId: string;
  let currencyId: string;

  const DOC_DATE = '2026-07-01';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`proc1-${run}@e2e.test`, `proc-t1-${run}`, 'PRO1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    const approverSetup = await setupApprover(tenant1Id, org1Id);
    approverToken = approverSetup.token;
    approverMembershipId = approverSetup.membershipId;
    const s2 = await setupTenant(`proc2-${run}@e2e.test`, `proc-t2-${run}`, 'PRO2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS8', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'P8-PROD-001', name: 'Procurement Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: 'SUP-001', name: 'Acme Supply Co', paymentTerms: 30 })
      .expect(201);
    supplierId = supplier.body.id;

    const customerOnly = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: 'CUST-P8', name: 'Customer Only Co' })
      .expect(201);
    customerOnlyId = customerOnly.body.id;

    const customer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: 'CUST-PEG', name: 'Peg Demand Co', creditLimit: 1000000 })
      .expect(201);
    customerId = customer.body.id;

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: 'WH-PROC', name: 'Procurement Warehouse' })
      .expect(201);
    warehouseId = wh.body.id;

    const curRes = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    currencyId = curRes.body.find((c: any) => c.code === 'USD')?.id;

    const pl = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists`))
      .send({ priceListType: 'PURCHASE', code: 'SUP-PL-001', name: 'Acme Purchase Prices', currencyId, validFrom: '2026-01-01', counterpartyId: supplierId })
      .expect(201);
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists/${pl.body.id}/prices`))
      .send({ productId, unitId, price: 20, minQuantity: 1 })
      .expect(201);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/supplier-product-codes`))
      .send({ counterpartyId: supplierId, productId, supplierCode: 'ACME-WIDGET-001', moq: 10, orderMultiple: 5, leadTimeDays: 7 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const regRes = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Test User' }).expect(201);
    const token = regRes.body.accessToken;
    const tenantRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'USD' })
      .expect(201);
    const tenantId = tenantRes.body.id;
    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .send({ code: orgCode, name: `${orgCode} Org` })
      .expect(201);
    return { token, tenantId, orgId: orgRes.body.id };
  }

  /** Registers a second tenant1 user holding every approval-chain role
   * (PROCUREMENT_OFFICER/DEPARTMENT_HEAD/DIRECTOR/FINANCE_USER/
   * ACCOUNTING_USER), distinct from token1 (the creator of every fixture
   * document below) — approval requires an approver who isn't the
   * document's own creator. No invite API exists yet, so membership/role
   * assignment goes straight through Prisma, same as phase1.e2e-spec.ts's
   * "outsider" fixture. */
  async function setupApprover(tenantId: string, organizationId: string): Promise<{ token: string; membershipId: string }> {
    const email = `proc-approver-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Approver' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId, accessLevel: 'FULL' } });

    const approvalPermissions = await prisma.permission.findMany({
      where: { code: { in: ['purchase.order.view', 'purchase.order.approve', 'purchase.order.reject', 'purchase.requirement.view', 'purchase.requirement.approve', 'purchase.requirement.reject', 'documents.view'] } },
    });
    for (const roleCode of ['PROCUREMENT_OFFICER', 'DEPARTMENT_HEAD', 'DIRECTOR', 'FINANCE_USER', 'ACCOUNTING_USER']) {
      // resolveApprover matches on Role.code exactly — this tenant is
      // freshly created per test run, so the real code is free to use.
      const role = await prisma.role.create({ data: { tenantId, code: roleCode, name: roleCode } });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await prisma.rolePermission.createMany({ data: approvalPermissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
    return { token: reg.body.accessToken, membershipId: membership.id };
  }

  function approverAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${approverToken}`).set('X-Tenant-Id', tenant1Id);
  }

  /** The approver's DEPARTMENT_HEAD eligibility is scoped by
   * OrganizationAccess.departmentId (a single row per membership+org) — set
   * it to whichever department the document being approved needs, or
   * `null` for a department-less document. */
  async function setApproverDepartment(organizationId: string, departmentId: string | null) {
    await prisma.organizationAccess.update({
      where: { tenantMembershipId_organizationId: { tenantMembershipId: approverMembershipId, organizationId } },
      data: { departmentId },
    });
  }

  /** Drives a PurchaseOrder's approval chain to completion as the
   * dedicated approver user (never the creator). Safe to call on an order
   * whose chain is already fully approved (no-op). */
  async function fullyApprovePurchaseOrder(organizationId: string, orderId: string) {
    for (let i = 0; i < 5; i++) {
      const current = await approverAuth(request(app.getHttpServer()).get(`/organizations/${organizationId}/purchase-orders/${orderId}`)).expect(200);
      if (current.body.approvalStatus === 'APPROVED') return;
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${organizationId}/purchase-orders/${orderId}/approve`)).send({}).expect(201);
    }
  }

  /** Approves a PurchaseRequirement's single DEPARTMENT_HEAD step. */
  async function approveRequirement(organizationId: string, requirementId: string) {
    await approverAuth(request(app.getHttpServer()).post(`/organizations/${organizationId}/purchase-requirements/${requirementId}/approve`)).send({}).expect(201);
  }

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function auth2(req: request.Test) {
    return req.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  }

  describe('Purchase Requirement (spec sections 1-11, 105)', () => {
    it('creates a manual requirement OPEN, cancels the remainder, and is tenant-isolated', async () => {
      const created = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 30 }] })
        .expect(201);
      expect(created.body.number).toMatch(/^PR-2026-\d+$/);
      expect(created.body.status).toBe('OPEN');

      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/purchase-requirements/${created.body.id}`)).expect(404);

      const cancelled = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${created.body.id}/cancel`))
        .send({ expectedVersion: created.body.version })
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(Number(cancelled.body.lines[0].cancelledQuantity)).toBeCloseTo(30, 6);
    });

    it('aggregates demand across multiple open requirement lines for the same product', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 30 }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 50 }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 20 }] })
        .expect(201);

      const coverage = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/procurement/demand-coverage`).query({ productId, warehouseId }),
      ).expect(200);
      expect(Number(coverage.body.totalRemaining)).toBeCloseTo(100, 6);
    });
  });

  describe('Supplier selection & eligibility (spec sections 41-50, 92, 107-108)', () => {
    it('lists the mapped supplier as a candidate with resolved price and tax preview', async () => {
      const candidates = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/procurement/supplier-candidates`).query({ productId, quantity: 10, date: DOC_DATE }),
      ).expect(200);
      const acme = candidates.body.find((c: any) => c.counterpartyId === supplierId);
      expect(acme).toBeDefined();
      expect(Number(acme.price)).toBeCloseTo(20, 6);
      expect(acme.supplierCode).toBe('ACME-WIDGET-001');
      expect(acme.taxPreview).not.toBeNull();
    });

    it('rejects a customer-only counterparty as a purchase order supplier', async () => {
      // Supplier eligibility (SUPPLIER/BOTH role, active) is enforced up
      // front at create() — mirroring SalesOrderService.assertCustomer —
      // so an ineligible counterparty never even produces a draft PO.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: customerOnlyId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5, price: 20 }] })
        .expect(422);
    });
  });

  describe('Purchase Order confirmation — no GL / AP / TaxMovement consequence (spec sections 94-97, 110-113)', () => {
    it('confirms a purchase order and leaves the ledger and tax register untouched', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, expectedDeliveryDate: '2026-07-15', lines: [{ productId, unitId, quantity: 100 }] })
        .expect(201);
      expect(po.body.number).toMatch(/^PO-2026-\d+$/);
      expect(Number(po.body.lines[0].price)).toBeCloseTo(20, 6); // resolved from PURCHASE price list

      await fullyApprovePurchaseOrder(org1Id, po.body.id);
      const confirmedPatch = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`))
        .send({ expectedVersion: po.body.version })
        .expect(201);
      expect(confirmedPatch.body.postingStatus).toBe('POSTED');
      const confirmed = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${po.body.id}`)).expect(200);

      const journalCount = await prisma.journalEntry.count({ where: { tenantId: tenant1Id, sourceDocumentType: PURCHASE_ORDER_TYPE, sourceDocumentId: po.body.id } });
      expect(journalCount).toBe(0);
      const taxMovementCount = await prisma.taxMovement.count({ where: { tenantId: tenant1Id, sourceDocumentType: PURCHASE_ORDER_TYPE, sourceDocumentId: po.body.id } });
      expect(taxMovementCount).toBe(0);

      const expected = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/procurement/expected-stock`).query({ productId, warehouseId }),
      ).expect(200);
      const forThisPO = expected.body.filter((r: any) => r.purchaseOrderId === po.body.id);
      expect(forThisPO).toHaveLength(1);
      expect(Number(forThisPO[0].quantity)).toBeCloseTo(100, 6);

      // Cancel 20 of the remaining line quantity — expected supply drops
      // to 80, original ordered quantity is never rewritten (spec 121).
      const line = confirmed.body.lines[0];
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/lines/${line.id}/cancel`))
        .send({ cancelQuantity: 20 })
        .expect(201);

      const expectedAfter = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/procurement/expected-stock`).query({ productId, warehouseId }),
      ).expect(200);
      const afterCancel = expectedAfter.body.find((r: any) => r.purchaseOrderId === po.body.id);
      expect(Number(afterCancel.quantity)).toBeCloseTo(80, 6);

      const storedLine = await prisma.purchaseOrderLine.findUnique({ where: { id: line.id } });
      expect(Number(storedLine!.quantity)).toBeCloseTo(100, 6); // original quantity untouched
      expect(Number(storedLine!.cancelledQuantity)).toBeCloseTo(20, 6);
    });

    it('blocks confirmation while an active hold exists, and allows it once released', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 10 }] })
        .expect(201);
      await fullyApprovePurchaseOrder(org1Id, po.body.id);

      const hold = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/holds`))
        .send({ holdType: 'BUDGET', reason: 'Awaiting budget approval' })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`))
        .send({ expectedVersion: po.body.version })
        .expect(409);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-order-holds/${hold.body.id}/release`)).expect(201);

      const confirmed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`))
        .send({ expectedVersion: po.body.version })
        .expect(201);
      expect(confirmed.body.postingStatus).toBe('POSTED');
    });
  });

  describe('Requirement -> PurchaseOrder allocation — multi-supplier partial ordering (spec sections 20, 53, 114, 122)', () => {
    it('allocates a requirement across two suppliers and tracks OPEN -> PARTIALLY_ORDERED -> FULLY_ORDERED', async () => {
      const supplierB = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: 'SUP-002', name: 'Beta Supply Co' })
        .expect(201);

      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 100 }] })
        .expect(201);
      const reqLineId = req.body.lines[0].id;
      await approveRequirement(org1Id, req.body.id);

      const poA = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/create-order`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, lines: [{ requirementLineId: reqLineId, quantity: 60, price: 20 }] })
        .expect(201);
      expect((poA.body.lines as any[])[0].requirementLineId).toBe(reqLineId);

      const midway = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-requirements/${req.body.id}`)).expect(200);
      expect(midway.body.status).toBe('PARTIALLY_ORDERED');

      // Over-allocating the remaining 40 is rejected.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/create-order`))
        .send({ counterpartyId: supplierB.body.id, documentDate: DOC_DATE, lines: [{ requirementLineId: reqLineId, quantity: 41, price: 22 }] })
        .expect(422);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/create-order`))
        .send({ counterpartyId: supplierB.body.id, documentDate: DOC_DATE, lines: [{ requirementLineId: reqLineId, quantity: 40, price: 22 }] })
        .expect(201);

      const final = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-requirements/${req.body.id}`)).expect(200);
      expect(final.body.status).toBe('FULLY_ORDERED');
    });
  });

  describe('Purchase Requirement department/creator auto-fill and multi-requirement PO creation', () => {
    it('auto-fills department (from the caller\'s own org access) and creator name when not explicitly provided', async () => {
      const dept = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`))
        .send({ code: `AUTO-${run}`, name: 'Auto-fill Department' })
        .expect(201);

      const myTenants = await auth1(request(app.getHttpServer()).get('/users/me/tenants')).expect(200);
      const membershipId = myTenants.body.find((t: any) => t.tenantId === tenant1Id).membershipId;

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/access`))
        .send({ membershipId, accessLevel: 'FULL', departmentId: dept.body.id })
        .expect(201);

      const mine = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/access/mine`)).expect(200);
      expect(mine.body.departmentId).toBe(dept.body.id);
      autoFillDepartmentId = dept.body.id;

      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 12 }] })
        .expect(201);
      expect(req.body.departmentId).toBe(dept.body.id);
      expect(req.body.department?.name).toBe('Auto-fill Department');
      expect(req.body.createdByName).toBe('Test User');

      // An explicit departmentId on the request still wins over the default.
      const otherDept = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`))
        .send({ code: `OTHER-${run}`, name: 'Other Department' })
        .expect(201);
      const reqExplicit = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, departmentId: otherDept.body.id, lines: [{ productId, unitId, quantity: 5 }] })
        .expect(201);
      expect(reqExplicit.body.departmentId).toBe(otherDept.body.id);
    });

    it('combines two same-department requirements into one purchase order, copying every remaining line and tracking each line\'s source requirement', async () => {
      const deptA = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`))
        .send({ code: `DEPTA-${run}`, name: 'Department A' })
        .expect(201);

      const req1 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, departmentId: deptA.body.id, lines: [{ productId, unitId, quantity: 15 }] })
        .expect(201);
      const req2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, departmentId: deptA.body.id, lines: [{ productId, unitId, quantity: 25 }] })
        .expect(201);

      await setApproverDepartment(org1Id, deptA.body.id);
      await approveRequirement(org1Id, req1.body.id);
      await approveRequirement(org1Id, req2.body.id);

      const combined = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/from-requirements`))
        .send({ requirementIds: [req1.body.id, req2.body.id], counterpartyId: supplierId, documentDate: DOC_DATE, priceIncludesTax: false })
        .expect(201);

      expect(combined.body.lines).toHaveLength(2);
      const totalQty = combined.body.lines.reduce((s: number, l: any) => s + Number(l.quantity), 0);
      expect(totalQty).toBeCloseTo(40, 6);
      const requirementLineIds = combined.body.lines.map((l: any) => l.requirementLineId).sort();
      expect(requirementLineIds).toEqual([req1.body.lines[0].id, req2.body.lines[0].id].sort());

      const req1After = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-requirements/${req1.body.id}`)).expect(200);
      const req2After = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-requirements/${req2.body.id}`)).expect(200);
      expect(req1After.body.status).toBe('FULLY_ORDERED');
      expect(req2After.body.status).toBe('FULLY_ORDERED');
    });

    it('blocks combining requirements from different departments, both request- and response-visibly', async () => {
      const deptA = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`))
        .send({ code: `MIXA-${run}`, name: 'Mix Department A' })
        .expect(201);
      const deptB = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`))
        .send({ code: `MIXB-${run}`, name: 'Mix Department B' })
        .expect(201);

      const reqA = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, departmentId: deptA.body.id, lines: [{ productId, unitId, quantity: 10 }] })
        .expect(201);
      const reqB = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, departmentId: deptB.body.id, lines: [{ productId, unitId, quantity: 10 }] })
        .expect(201);

      await setApproverDepartment(org1Id, deptA.body.id);
      await approveRequirement(org1Id, reqA.body.id);
      await setApproverDepartment(org1Id, deptB.body.id);
      await approveRequirement(org1Id, reqB.body.id);

      const rejected = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/from-requirements`))
        .send({ requirementIds: [reqA.body.id, reqB.body.id], counterpartyId: supplierId, documentDate: DOC_DATE })
        .expect(400);
      expect(rejected.body.code).toBe('REQUIREMENT_DEPARTMENT_MISMATCH');

      // Neither requirement was touched by the rejected attempt.
      const reqAAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-requirements/${reqA.body.id}`)).expect(200);
      expect(reqAAfter.body.status).toBe('OPEN');
    });
  });

  describe('Purchase order lines with no resolvable price (spec: requirement -> order, blank price allowed as DRAFT)', () => {
    it('creates a draft PO with a blank price when the requirement product has no purchase price list, blocks confirmation with a clear error, then confirms once every price is filled in', async () => {
      const noPriceProduct = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
        .send({ code: `P8-NOPRICE-${run}`, name: 'No Purchase Price Widget', productType: 'GOODS', baseUnitId: unitId })
        .expect(201);

      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId: noPriceProduct.body.id, unitId, quantity: 8, description: 'Needed urgently' }] })
        .expect(201);
      await setApproverDepartment(org1Id, autoFillDepartmentId ?? null);
      await approveRequirement(org1Id, req.body.id);

      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/from-requirements`))
        .send({ requirementIds: [req.body.id], counterpartyId: supplierId, documentDate: DOC_DATE })
        .expect(201);
      await fullyApprovePurchaseOrder(org1Id, order.body.id);

      expect(order.body.lines).toHaveLength(1);
      const line = order.body.lines[0];
      expect(line.price).toBeNull();
      expect(line.description).toBe('Needed urgently');
      expect(line.requirementLineId).toBe(req.body.lines[0].id);
      expect(order.body.status).toBe('DRAFT');

      // Confirming (posting) is blocked while the price is missing, with a
      // clear, itemized error rather than a generic 400.
      const blocked = await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_ORDER/${order.body.id}/post`))
        .send({ expectedVersion: order.body.version })
        .expect(400);
      expect(blocked.body.message).toMatch(/price/i);
      expect(blocked.body.fieldErrors?.price).toEqual([line.id]);

      // Filling in the price allows confirmation to succeed.
      const priced = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/purchase-orders/${order.body.id}`))
        .send({ expectedVersion: order.body.version, lines: [{ productId: noPriceProduct.body.id, unitId, quantity: 8, price: 42, description: 'Needed urgently', requirementLineId: req.body.lines[0].id }] })
        .expect(200);
      expect(priced.body.lines[0].price).toBe('42');

      await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_ORDER/${order.body.id}/post`))
        .send({ expectedVersion: priced.body.version })
        .expect(201);
    });
  });

  describe('Purchase Order Payment Schedule (spec sections 70, 119)', () => {
    it('generates installments that sum exactly to the order total, rounding into the last line', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 3, price: 33.33 }] })
        .expect(201);
      const total = Number(po.body.grandTotal);

      const schedule = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/payment-schedule`))
        .send({ installments: [
          { dueDate: '2026-07-01', basis: 'ADVANCE', percentage: 30 },
          { dueDate: '2026-08-01', basis: 'AFTER_RECEIPT', percentage: 70 },
        ] })
        .expect(201);

      const sum = schedule.body.reduce((s: number, i: any) => s + Number(i.amount), 0);
      expect(sum).toBeCloseTo(total, 2);
      expect(schedule.body[0].basis).toBe('ADVANCE');
    });
  });

  describe('Demand-Supply Pegging (spec sections 73-77)', () => {
    it('pegs a SalesOrderLine demand to a PurchaseOrderLine supply and rejects over-pegging', async () => {
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 25, price: 99 }] })
        .expect(201);
      const demandLineId = order.body.lines[0].id;

      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 25, price: 20 }] })
        .expect(201);
      const supplyLineId = po.body.lines[0].id;

      const peg = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/supply-pegs`))
        .send({ demandType: 'SALES_ORDER', demandId: order.body.id, demandLineId, supplyType: 'PURCHASE_ORDER', supplyId: po.body.id, supplyLineId, quantity: 25 })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/supply-pegs`))
        .send({ demandType: 'SALES_ORDER', demandId: order.body.id, demandLineId, supplyType: 'PURCHASE_ORDER', supplyId: po.body.id, supplyLineId, quantity: 1 })
        .expect(422); // demand already fully pegged

      const list = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/supply-pegs`).query({ demandType: 'SALES_ORDER', demandId: order.body.id, demandLineId }),
      ).expect(200);
      expect(list.body).toHaveLength(1);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/supply-pegs/${peg.body.id}/remove`)).expect(201);
      const afterRemove = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/supply-pegs`).query({ demandType: 'SALES_ORDER', demandId: order.body.id, demandLineId }),
      ).expect(200);
      expect(afterRemove.body).toHaveLength(0);
    });
  });

  describe('Approval workflow MVP (department-head requirement approval, multi-step PO approval chain)', () => {
    it('a new requirement starts PENDING with one DEPARTMENT_HEAD step, and blocks create-order until approved', async () => {
      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5 }] })
        .expect(201);
      expect(req.body.approvalStatus).toBe('PENDING');

      const steps = await auth1(
        request(app.getHttpServer()).get('/approval-steps').query({ documentType: 'PURCHASE_REQUIREMENT', documentId: req.body.id }),
      ).expect(200);
      expect(steps.body).toHaveLength(1);
      expect(steps.body[0].stepType).toBe('DEPARTMENT_HEAD');
      expect(steps.body[0].status).toBe('PENDING');

      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/create-order`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, lines: [{ requirementLineId: req.body.lines[0].id, quantity: 5, price: 20 }] })
        .expect(400);
      expect(blocked.body.message).toMatch(/not approved/i);

      // Also blocked through the direct endpoint, bypassing planning entirely.
      const bypassed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5, price: 20, requirementLineId: req.body.lines[0].id }] })
        .expect(400);
      expect(bypassed.body.message).toMatch(/not approved/i);

      // The creator (token1) cannot approve their own requirement.
      const selfApprove = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/approve`)).send({});
      expect(selfApprove.status).toBe(400);
      expect(selfApprove.body.message).toMatch(/yourself/i);

      await approveRequirement(org1Id, req.body.id);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-requirements/${req.body.id}`)).expect(200);
      expect(approved.body.approvalStatus).toBe('APPROVED');

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/create-order`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, lines: [{ requirementLineId: req.body.lines[0].id, quantity: 5, price: 20 }] })
        .expect(201);
    });

    it('runs a manual PO through its PROCUREMENT_OFFICER -> DIRECTOR chain in order, and blocks posting until fully approved', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 3, price: 20 }] })
        .expect(201);
      expect(po.body.approvalStatus).toBe('PENDING');

      const steps = await auth1(
        request(app.getHttpServer()).get('/approval-steps').query({ documentType: 'PURCHASE_ORDER', documentId: po.body.id }),
      ).expect(200);
      // No requirement-linked line -> DEPARTMENT_HEAD is auto-SKIPPED.
      expect(steps.body.map((s: any) => s.stepType)).toEqual(['PROCUREMENT_OFFICER', 'DEPARTMENT_HEAD', 'DIRECTOR']);
      expect(steps.body[1].status).toBe('SKIPPED');

      // Out-of-order: DIRECTOR cannot act before PROCUREMENT_OFFICER's step.
      // (resolveApprover would grant this approver DIRECTOR eligibility,
      // but decide() only ever looks at the earliest PENDING step, which
      // is still PROCUREMENT_OFFICER — so there's nothing to force out of
      // order to begin with; instead we verify the sequence is honored.)
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/approve`)).send({}).expect(201);
      let mid = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${po.body.id}`)).expect(200);
      expect(mid.body.approvalStatus).toBe('PENDING');

      const blockedPost = await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_ORDER/${po.body.id}/post`))
        .send({ expectedVersion: po.body.version })
        .expect(400);
      expect(blockedPost.body.message).toMatch(/approved/i);

      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/approve`)).send({}).expect(201);
      mid = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${po.body.id}`)).expect(200);
      expect(mid.body.approvalStatus).toBe('APPROVED');

      await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_ORDER/${po.body.id}/post`))
        .send({ expectedVersion: po.body.version })
        .expect(201);
    });

    it('adds a FINANCE step once the AZN-equivalent grand total exceeds the threshold', async () => {
      const bigPo = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 600, price: 20 }] })
        .expect(201);
      expect(Number(bigPo.body.grandTotal)).toBeGreaterThan(10000);

      const steps = await auth1(
        request(app.getHttpServer()).get('/approval-steps').query({ documentType: 'PURCHASE_ORDER', documentId: bigPo.body.id }),
      ).expect(200);
      expect(steps.body.map((s: any) => s.stepType)).toEqual(['PROCUREMENT_OFFICER', 'DEPARTMENT_HEAD', 'DIRECTOR', 'FINANCE']);

      await fullyApprovePurchaseOrder(org1Id, bigPo.body.id);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${bigPo.body.id}`)).expect(200);
      expect(approved.body.approvalStatus).toBe('APPROVED');
    });

    it('rejecting a step skips the remaining ones and sets the requirement REJECTED', async () => {
      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5 }] })
        .expect(201);

      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/reject`))
        .send({ comment: 'Not needed this quarter' })
        .expect(201);

      const rejected = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-requirements/${req.body.id}`)).expect(200);
      expect(rejected.body.approvalStatus).toBe('REJECTED');

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${req.body.id}/create-order`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, lines: [{ requirementLineId: req.body.lines[0].id, quantity: 5, price: 20 }] })
        .expect(400);
    });
  });

  describe('Tenant isolation (spec section 125)', () => {
    it('tenant B cannot see tenant A supplier, requirement, or purchase order', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5 }] })
        .expect(201);

      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/purchase-orders/${po.body.id}`)).expect(404);
      await auth2(request(app.getHttpServer()).post(`/organizations/${org2Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 5, price: 1 }] })
        .expect(400); // counterparty does not belong to tenant B's organization
    });
  });
});
