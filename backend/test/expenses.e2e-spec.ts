/**
 * Expenses / Cost Centers / Employee Expenses E2E tests (docx spec Phase
 * 20). Built incrementally alongside the module (same convention as
 * payroll.e2e-spec.ts) — each `it` block is added right after the
 * capability it exercises lands, so a real integration bug surfaces
 * immediately rather than at the very end of the phase.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { CASH_TRANSACTION_TYPE } from '../src/treasury/cash-transaction.repository';
import * as request from 'supertest';

describe('Expenses / Cost Centers / Employee Expenses (e2e)', () => {
  let app: INestApplication;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let deptId: string;
  let positionId: string;

  let travelCategoryId: string;
  let softwareCategoryId: string;
  let officeSuppliesCategoryId: string;
  let costCenterAId: string;
  let costCenterBId: string;
  let costCenterSharedId: string;
  let manualPercentageDriverId: string;
  let aznId: string;
  let cashboxId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const s1 = await setupTenant(`ex1-${run}@e2e.test`, `ex-t1-${run}`, 'EX1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;

    const charts = moduleFixture.get(ChartOfAccountsService);
    await charts.ensureAdopted(tenant1Id);
    const localization = moduleFixture.get(AzTaxLocalizationService);
    await localization.ensureSeeded();

    const currencies = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    aznId = currencies.body.find((c: any) => c.code === 'AZN').id;
    const cashbox = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`))
      .send({ code: `EXCB-${run}`, name: 'Expense advance cashbox', currencyId: aznId })
      .expect(201);
    cashboxId = cashbox.body.id;

    const dept = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`))
      .send({ code: `SALES-${run}`, name: 'Sales' })
      .expect(201);
    deptId = dept.body.id;

    const position = await auth1(request(app.getHttpServer()).post('/hr/positions'))
      .send({ code: `REP-${run}`, name: 'Sales Rep' })
      .expect(201);
    positionId = position.body.id;

    await auth1(request(app.getHttpServer()).post('/expenses/setup/seed-defaults')).expect(201);
    const categories = await auth1(request(app.getHttpServer()).get('/expenses/setup/categories')).expect(200);
    travelCategoryId = categories.body.find((c: any) => c.code === 'TRAVEL').id;
    softwareCategoryId = categories.body.find((c: any) => c.code === 'SOFTWARE_SUBSCRIPTION').id;
    officeSuppliesCategoryId = categories.body.find((c: any) => c.code === 'OFFICE_SUPPLIES').id;

    const ccA = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-centers`))
      .send({ code: `CC-A-${run}`, name: 'Cost Center A', departmentId: deptId })
      .expect(201);
    costCenterAId = ccA.body.id;
    const ccB = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-centers`))
      .send({ code: `CC-B-${run}`, name: 'Cost Center B', departmentId: deptId })
      .expect(201);
    costCenterBId = ccB.body.id;
    const ccShared = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-centers`))
      .send({ code: `CC-SHARED-${run}`, name: 'Shared Services', departmentId: deptId })
      .expect(201);
    costCenterSharedId = ccShared.body.id;

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/drivers/seed-defaults`)).expect(201);
    const drivers = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/cost-allocations/drivers`)).expect(200);
    manualPercentageDriverId = drivers.body.find((d: any) => d.code === 'MANUAL_PERCENTAGE').id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Test1234!', displayName: 'Test User' })
      .expect(201);
    const token = regRes.body.accessToken;
    const tenantRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'AZN' })
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

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }

  async function hireEmployee(firstName: string, lastName: string, personalId: string, hireDate: string) {
    const draft = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`))
      .send({
        newPerson: { firstName, lastName, personalId },
        employmentType: 'PRIMARY',
        hireDate,
        departmentId: deptId,
        positionId,
      })
      .expect(201);
    const posted = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/post`),
    )
      .send({ expectedVersion: draft.body.version })
      .expect(201);
    return posted.body.employmentId as string;
  }

  async function createResponsiblePerson(displayName: string) {
    const res = await auth1(request(app.getHttpServer()).post('/responsible-persons'))
      .send({ displayName })
      .expect(201);
    return res.body.id as string;
  }

  async function issueAdvance(responsiblePersonId: string, amount: number) {
    // Fund the cashbox first (a fresh test cashbox always starts at 0 —
    // negative balance is blocked by policy).
    const funding = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
      .send({ documentDate: '2026-03-01', cashboxId, direction: 'RECEIPT', category: 'OTHER_INCOME', amount })
      .expect(201);
    await postDocument(CASH_TRANSACTION_TYPE, funding.body.id, funding.body.version);

    const created = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
      .send({
        documentDate: '2026-03-01',
        cashboxId,
        direction: 'PAYMENT',
        category: 'EMPLOYEE_ADVANCE',
        amount,
        employeeId: responsiblePersonId,
      })
      .expect(201);
    await postDocument(CASH_TRANSACTION_TYPE, created.body.id, created.body.version);
  }

  async function postDocument(documentType: string, id: string, expectedVersion: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/documents/${documentType}/${id}/post`)).send({
      expectedVersion,
    });
    if (res.status !== 201) console.log('DOC POST FAILED', documentType, JSON.stringify(res.body));
    return { status: res.status, body: res.body };
  }

  async function submitAndApprove(
    claimId: string,
    claimVersion: number,
    approvals: Array<{ lineId: string; approvedAmount: number; reason?: string }>,
  ) {
    const submitted = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims/${claimId}/submit`),
    )
      .send({ expectedVersion: claimVersion })
      .expect(201);
    const approved = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims/${claimId}/approve`),
    )
      .send({ expectedVersion: submitted.body.version, lines: approvals })
      .expect(201);
    return approved;
  }

  // ---------------------------------------------------------------------
  // Expense Claim create + submit — spec sections 11-19
  // ---------------------------------------------------------------------

  it('creates and submits an expense claim, blocking submission when a mandatory receipt is missing', async () => {
    const employmentId = await hireEmployee('Claim', 'Owner', `PID-${run}-CLM`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2026-02-10',
        lines: [
          {
            expenseDate: '2026-02-05',
            expenseCategoryId: travelCategoryId,
            businessPurpose: 'Client meeting in Ganja',
            transactionCurrencyId: aznId,
            transactionAmount: 150,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
            costCenterId: costCenterAId,
          },
        ],
      })
      .expect(201);
    expect(Number(claim.body.totalClaimedAmount)).toBeCloseTo(150, 2);
    expect(claim.body.claimStatus).toBe('DRAFT');
    const lineId = claim.body.lines[0].id;

    // TRAVEL requires a receipt (seeded default) — submitting without one
    // is refused outright, never silently approved.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims/${claim.body.id}/submit`))
      .send({ expectedVersion: claim.body.version })
      .expect(400);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/receipts`))
      .send({
        claimLineId: lineId,
        documentType: 'FISCAL_RECEIPT',
        documentNumber: `RCPT-${run}`,
        supplier: 'Ganja Hotel LLC',
        documentDate: '2026-02-05',
        amount: 150,
      })
      .expect(201);

    const submitted = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims/${claim.body.id}/submit`),
    )
      .send({ expectedVersion: claim.body.version })
      .expect(201);
    expect(submitted.body.claimStatus).toBe('PENDING_APPROVAL');

    // Duplicate receipt (same supplier/number/date/amount) is blocked.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/receipts`))
      .send({
        claimLineId: lineId,
        documentType: 'FISCAL_RECEIPT',
        documentNumber: `RCPT-${run}`,
        supplier: 'Ganja Hotel LLC',
        documentDate: '2026-02-05',
        amount: 150,
      })
      .expect(400);
  });

  it('rejects claiming a business-purpose-required category with no business purpose', async () => {
    const employmentId = await hireEmployee('NoPurpose', 'Employee', `PID-${run}-NOPURPOSE`, '2026-01-01');
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2026-02-10',
        lines: [
          {
            expenseDate: '2026-02-05',
            expenseCategoryId: travelCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 30,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
          },
        ],
      })
      .expect(400);
  });

  // ---------------------------------------------------------------------
  // Employee Advance settlement — spec sections 21-28, tests 170-173
  // ---------------------------------------------------------------------

  it('settles an approved claim against an outstanding advance, leaving the remainder as employee debt', async () => {
    const employmentId = await hireEmployee('Advance', 'Settled', `PID-${run}-ADV1`, '2026-01-01');
    const personId = await createResponsiblePerson(`Advance Settled ${run}`);
    await issueAdvance(personId, 1000);

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        responsiblePersonId: personId,
        claimDate: '2026-03-10',
        lines: [
          {
            expenseDate: '2026-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 800,
            paymentSourceType: 'EMPLOYEE_ADVANCE',
            costCenterId: costCenterAId,
          },
        ],
      })
      .expect(201);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 800 },
    ]);
    expect(approved.body.claimStatus).toBe('APPROVED');
    expect(Number(approved.body.advanceAppliedAmount)).toBeCloseTo(800, 2);
    expect(Number(approved.body.reimbursementDue)).toBeCloseTo(0, 2);
    expect(Number(approved.body.employeeDebtDue)).toBeCloseTo(200, 2);

    const balance = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/accountable-persons/${personId}/balance`),
    ).expect(200);
    expect(balance.body.find((r: any) => r.currencyId === aznId)?.outstanding).toBe('200.00');
  });

  it('creates an employee reimbursement payable when approved expenses exceed the advance', async () => {
    const employmentId = await hireEmployee('Advance', 'Overspend', `PID-${run}-ADV2`, '2026-01-01');
    const personId = await createResponsiblePerson(`Advance Overspend ${run}`);
    await issueAdvance(personId, 1000);

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        responsiblePersonId: personId,
        claimDate: '2026-03-10',
        lines: [
          {
            expenseDate: '2026-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 1300,
            paymentSourceType: 'EMPLOYEE_ADVANCE',
          },
        ],
      })
      .expect(201);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 1300 },
    ]);
    expect(Number(approved.body.advanceAppliedAmount)).toBeCloseTo(1000, 2);
    expect(Number(approved.body.reimbursementDue)).toBeCloseTo(300, 2);
    expect(Number(approved.body.employeeDebtDue)).toBeCloseTo(0, 2);

    const balance = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/accountable-persons/${personId}/balance`),
    ).expect(200);
    expect(balance.body.find((r: any) => r.currencyId === aznId)?.outstanding ?? '0.00').toBe('0.00');
  });

  it('recognizes the full approved amount as a reimbursement payable when the employee received no advance', async () => {
    const employmentId = await hireEmployee('NoAdvance', 'Employee', `PID-${run}-NOADV`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2026-03-10',
        lines: [
          {
            expenseDate: '2026-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 500,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
          },
        ],
      })
      .expect(201);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 500 },
    ]);
    expect(Number(approved.body.advanceAppliedAmount)).toBeCloseTo(0, 2);
    expect(Number(approved.body.reimbursementDue)).toBeCloseTo(500, 2);
  });

  it('partially approves a claim, keeping claimed and approved amounts distinct', async () => {
    const employmentId = await hireEmployee('Partial', 'Approval', `PID-${run}-PARTIAL`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2026-03-10',
        lines: [
          {
            expenseDate: '2026-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 1000,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
          },
        ],
      })
      .expect(201);
    expect(Number(claim.body.totalClaimedAmount)).toBeCloseTo(1000, 2);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 800, reason: 'Above policy — partially allowed' },
    ]);
    expect(approved.body.claimStatus).toBe('PARTIALLY_APPROVED');
    expect(Number(approved.body.totalClaimedAmount)).toBeCloseTo(1000, 2);
    expect(Number(approved.body.totalApprovedAmount)).toBeCloseTo(800, 2);
    expect(Number(approved.body.reimbursementDue)).toBeCloseTo(800, 2);
  });

  // ---------------------------------------------------------------------
  // VAT split via the Phase 5 Tax Engine — spec test 177
  // ---------------------------------------------------------------------

  it('splits a gross expense into net expense + recoverable VAT via the Tax Engine, never posting the gross as expense', async () => {
    const employmentId = await hireEmployee('Vat', 'Split', `PID-${run}-VAT`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2026-03-10',
        lines: [
          {
            expenseDate: '2026-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 118,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
          },
        ],
      })
      .expect(201);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 118 },
    ]);
    const line = approved.body.lines[0];
    expect(Number(line.baseAmount)).toBeCloseTo(118, 2);
    expect(Number(line.vatAmount)).toBeCloseTo(18, 2);
    expect(Number(line.recoverableVat)).toBeCloseTo(18, 2);
    expect(Number(line.nonrecoverableVat)).toBeCloseTo(0, 2);
    // The net expense (what a GL Dr Expense line would carry) is gross
    // minus VAT — never the gross figure itself (spec test 177).
    expect(Number(line.baseAmount) - Number(line.vatAmount)).toBeCloseTo(100, 2);
  });

  // ---------------------------------------------------------------------
  // GL Posting (document-framework participant) — spec sections 92-101
  // ---------------------------------------------------------------------

  it('posts an approved claim to the GL as a balanced entry (net expense + recoverable VAT = employee reimbursement payable)', async () => {
    const employmentId = await hireEmployee('Post', 'Claim', `PID-${run}-POSTCLAIM`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2026-03-10',
        lines: [
          {
            expenseDate: '2026-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 118,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
            costCenterId: costCenterAId,
          },
        ],
      })
      .expect(201);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 118 },
    ]);
    expect(approved.body.claimStatus).toBe('APPROVED');

    const posted = await postDocument('EXPENSE_CLAIM', claim.body.id, approved.body.version);
    expect(posted.body.postingStatus).toBe('POSTED');

    const journal = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/accounting/journal-entries?sourceDocumentType=EXPENSE_CLAIM&sourceDocumentId=${claim.body.id}`,
      ),
    ).expect(200);
    expect(journal.body.length).toBe(1);
    const glLines = journal.body[0].lines;
    const debit = glLines.filter((l: any) => l.side === 'DEBIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
    const credit = glLines.filter((l: any) => l.side === 'CREDIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(118, 2);
  });

  it('never re-recognizes an expense a Supplier Invoice already recognized (SUPPLIER_SETTLEMENT is excluded from GL and the register)', async () => {
    const employmentId = await hireEmployee('NoDouble', 'Count', `PID-${run}-NODOUBLE`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2026-03-10',
        lines: [
          {
            expenseDate: '2026-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 1000,
            paymentSourceType: 'SUPPLIER_PAYABLE',
            sourceDocumentType: 'PURCHASE_INVOICE',
            sourceDocumentId: `fake-invoice-${run}`,
          },
        ],
      })
      .expect(201);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 1000 },
    ]);
    expect(approved.body.lines[0].classification).toBe('SUPPLIER_SETTLEMENT');

    const posted = await postDocument('EXPENSE_CLAIM', claim.body.id, approved.body.version);
    expect(posted.body.postingStatus).toBe('POSTED');

    // No journal entry at all — the line contributed nothing to post.
    const journal = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/accounting/journal-entries?sourceDocumentType=EXPENSE_CLAIM&sourceDocumentId=${claim.body.id}`,
      ),
    ).expect(200);
    expect(journal.body.length).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Prepaid Expense + Recognition Run — spec sections 33-41, tests 179/192
  // ---------------------------------------------------------------------

  it('recognizes a 12-month prepaid expense straight-line and never double-recognizes a period on retry', async () => {
    const prepaid = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/prepaids`))
      .send({
        expenseCategoryId: softwareCategoryId,
        originalAmount: 1200,
        recognitionStartDate: '2027-01-01',
        recognitionEndDate: '2027-12-31',
        allocationMethod: 'STRAIGHT_LINE_BY_MONTH',
        costCenterId: costCenterAId,
      })
      .expect(201);
    expect(prepaid.body.schedule.length).toBe(12);
    expect(Number(prepaid.body.remainingAmount)).toBeCloseTo(1200, 2);
    const total = prepaid.body.schedule.reduce((s: number, r: any) => s + Number(r.plannedRecognitionAmount), 0);
    expect(total).toBeCloseTo(1200, 2);
    expect(Number(prepaid.body.schedule[0].plannedRecognitionAmount)).toBeCloseTo(100, 2);

    const run1 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/prepaids/recognize`))
      .send({ periodYear: 2027, periodMonth: 1 })
      .expect(201);
    expect(run1.body.itemsProcessed).toBe(1);
    expect(Number(run1.body.totalAmount)).toBeCloseTo(100, 2);

    const afterFirst = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/prepaids/${prepaid.body.id}`),
    ).expect(200);
    expect(Number(afterFirst.body.recognizedAmount)).toBeCloseTo(100, 2);
    expect(Number(afterFirst.body.remainingAmount)).toBeCloseTo(1100, 2);
    expect(afterFirst.body.status).toBe('ACTIVE');
    expect(afterFirst.body.schedule.find((r: any) => r.periodMonth === 1).status).toBe('RECOGNIZED');

    // Retrying the SAME period recognizes nothing further (spec test 192).
    const run2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/prepaids/recognize`))
      .send({ periodYear: 2027, periodMonth: 1 })
      .expect(201);
    expect(run2.body.itemsProcessed).toBe(0);

    const afterRetry = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/prepaids/${prepaid.body.id}`),
    ).expect(200);
    expect(Number(afterRetry.body.recognizedAmount)).toBeCloseTo(100, 2);
  });

  // ---------------------------------------------------------------------
  // Cost Allocation (Drivers, Rules, Runs) — spec sections 57-74, 183/185
  // ---------------------------------------------------------------------

  it('allocates a shared cost by a headcount driver, reconciling to the exact total with no residual and no double counting', async () => {
    const employmentId = await hireEmployee('Shared', 'Cost', `PID-${run}-SHARED`, '2026-01-01');
    // Gross 14,160 at 18% VAT nets to exactly 12,000 — keeps the
    // allocation math clean (spec's own 12,000 example).
    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2027-02-10',
        lines: [
          {
            expenseDate: '2027-02-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 14160,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
            costCenterId: costCenterSharedId,
          },
        ],
      })
      .expect(201);
    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 14160 },
    ]);
    await postDocument('EXPENSE_CLAIM', claim.body.id, approved.body.version);

    const headcountDriver = (
      await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/cost-allocations/drivers`)).expect(200)
    ).body.find((d: any) => d.code === 'HEADCOUNT');

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/drivers/values`))
      .send({ allocationDriverId: headcountDriver.id, periodYear: 2027, periodMonth: 2, targetType: 'COST_CENTER', targetId: costCenterAId, value: 10 })
      .expect(201);
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/drivers/values`))
      .send({ allocationDriverId: headcountDriver.id, periodYear: 2027, periodMonth: 2, targetType: 'COST_CENTER', targetId: costCenterBId, value: 20 })
      .expect(201);

    const rule = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/rules`))
      .send({
        code: `SHARED-RULE-${run}`,
        name: 'Shared services allocation',
        sourceCostCenterId: costCenterSharedId,
        allocationType: 'DRIVER_BASED',
        allocationDriverId: headcountDriver.id,
        targets: [
          { targetType: 'COST_CENTER', targetId: costCenterAId },
          { targetType: 'COST_CENTER', targetId: costCenterBId },
        ],
        effectiveFrom: '2027-01-01',
      })
      .expect(201);

    const preview = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/preview`))
      .send({ periodYear: 2027, periodMonth: 2 })
      .expect(201);
    expect(Number(preview.body.sourceAmount)).toBeCloseTo(12000, 2);
    expect(Number(preview.body.allocatedAmount)).toBeCloseTo(12000, 2);
    expect(Number(preview.body.residual)).toBeCloseTo(0, 3);

    const calculated = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/run`))
      .send({ periodYear: 2027, periodMonth: 2 })
      .expect(201);
    expect(calculated.body.status).toBe('CALCULATED');
    const lineA = calculated.body.lines.find((l: any) => l.targetId === costCenterAId);
    const lineB = calculated.body.lines.find((l: any) => l.targetId === costCenterBId);
    expect(Number(lineA.allocatedAmount)).toBeCloseTo(4000, 2);
    expect(Number(lineB.allocatedAmount)).toBeCloseTo(8000, 2);
    expect(Number(lineA.allocatedAmount) + Number(lineB.allocatedAmount)).toBeCloseTo(12000, 2);

    const posted = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/${calculated.body.id}/post`),
    )
      .send({ expectedVersion: calculated.body.calculationVersion })
      .expect(201);
    expect(posted.body.status).toBe('POSTED');

    const journal = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/accounting/journal-entries?sourceDocumentType=COST_ALLOCATION_RUN&sourceDocumentId=${calculated.body.id}`,
      ),
    ).expect(200);
    expect(journal.body.length).toBe(1);
    const glLines = journal.body[0].lines;
    const debit = glLines.filter((l: any) => l.side === 'DEBIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
    const credit = glLines.filter((l: any) => l.side === 'CREDIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(12000, 2);
  });

  it('detects a reciprocal allocation cycle and blocks the rule from being created', async () => {
    const forward = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/rules`))
      .send({
        code: `CYCLE-FWD-${run}`,
        name: 'Forward',
        sourceCostCenterId: costCenterAId,
        allocationType: 'DIRECT',
        targets: [{ targetType: 'COST_CENTER', targetId: costCenterBId }],
        effectiveFrom: '2027-01-01',
      })
      .expect(201);
    expect(forward.body.code).toBe(`CYCLE-FWD-${run}`);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/rules`))
      .send({
        code: `CYCLE-BACK-${run}`,
        name: 'Reciprocal back',
        sourceCostCenterId: costCenterBId,
        allocationType: 'DIRECT',
        targets: [{ targetType: 'COST_CENTER', targetId: costCenterAId }],
        effectiveFrom: '2027-01-01',
      })
      .expect(400);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-allocations/rules`))
      .send({
        code: `SELF-LOOP-${run}`,
        name: 'Self loop',
        sourceCostCenterId: costCenterAId,
        allocationType: 'DIRECT',
        targets: [{ targetType: 'COST_CENTER', targetId: costCenterAId }],
        effectiveFrom: '2027-01-01',
      })
      .expect(400);
  });

  // ---------------------------------------------------------------------
  // Budget vs Actual — spec sections 76-82, 144
  // ---------------------------------------------------------------------

  it('computes budget vs actual from the posted Expense Movement Register, never from claim totals directly', async () => {
    const employmentId = await hireEmployee('Budget', 'Actual', `PID-${run}-BUDGET`, '2026-01-01');

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/budgets`))
      .send({ periodYear: 2027, periodMonth: 3, costCenterId: costCenterAId, currencyId: aznId, budgetAmount: 5000, committedAmount: 500 })
      .expect(201);

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2027-03-10',
        lines: [
          {
            expenseDate: '2027-03-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 1000,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
            costCenterId: costCenterAId,
          },
        ],
      })
      .expect(201);
    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 1000 },
    ]);
    await postDocument('EXPENSE_CLAIM', claim.body.id, approved.body.version);

    const vsActual = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/budgets/vs-actual?periodYear=2027&periodMonth=3`),
    ).expect(200);
    const row = vsActual.body.find((r: any) => r.costCenterId === costCenterAId);
    expect(Number(row.budget)).toBeCloseTo(5000, 2);
    expect(Number(row.committed)).toBeCloseTo(500, 2);
    // `transactionAmount: 1000` is treated as GROSS by the Tax Engine —
    // actual comes from the posted register's NET expense (1000/1.18),
    // never the claim's gross total.
    expect(Number(row.actual)).toBeCloseTo(847.46, 2);
    expect(Number(row.available)).toBeCloseTo(5000 - 500 - 847.46, 2);
  });

  // ---------------------------------------------------------------------
  // Adjustments (cost-center reclassification) — spec sections 106-114
  // ---------------------------------------------------------------------

  it('reclassifies a posted claim line into a different cost center via a balanced GL adjustment, never re-posting the original claim', async () => {
    const employmentId = await hireEmployee('Reclass', 'Target', `PID-${run}-RECLASS`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2027-04-10',
        lines: [
          {
            expenseDate: '2027-04-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 600,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
            costCenterId: costCenterAId,
          },
        ],
      })
      .expect(201);
    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 600 },
    ]);
    const posted = await postDocument('EXPENSE_CLAIM', claim.body.id, approved.body.version);
    expect(posted.body.postingStatus).toBe('POSTED');
    const lineId = approved.body.lines[0].id;

    const adjustment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/adjustments/reclassify-cost-center`))
      .send({ claimLineId: lineId, newCostCenterId: costCenterBId, reason: 'Wrong cost center at entry' })
      .expect(201);
    expect(adjustment.body.adjustmentType).toBe('RECLASSIFY_COST_CENTER');
    expect(adjustment.body.status).toBe('POSTED');

    const journal = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/accounting/journal-entries?sourceDocumentType=EXPENSE_ADJUSTMENT&sourceDocumentId=${adjustment.body.id}`,
      ),
    ).expect(200);
    expect(journal.body.length).toBe(1);
    const glLines = journal.body[0].lines;
    const debit = glLines.filter((l: any) => l.side === 'DEBIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
    const credit = glLines.filter((l: any) => l.side === 'CREDIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(600, 2);

    const pnl = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/reports/cost-center-pnl?fromDate=2027-04-01&toDate=2027-04-30`),
    ).expect(200);
    const ccA = pnl.body.find((r: any) => r.costCenterId === costCenterAId);
    const ccB = pnl.body.find((r: any) => r.costCenterId === costCenterBId);
    expect(Number(ccA.allocatedOut)).toBeCloseTo(600, 2);
    expect(Number(ccB.allocatedIn)).toBeCloseTo(600, 2);

    const list = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/adjustments`)).expect(200);
    expect(list.body.some((a: any) => a.id === adjustment.body.id)).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Expense Period close/reopen — spec sections 116-118
  // ---------------------------------------------------------------------

  it('blocks closing an expense period with an unresolved claim, then allows it once resolved, and supports reopen', async () => {
    const employmentId = await hireEmployee('Period', 'Close', `PID-${run}-PERIODCLOSE`, '2026-01-01');

    // A fresh cost center with no ACTIVE AllocationRule sourced from it —
    // isolates this test from CYCLE-FWD/SHARED-RULE created earlier,
    // whose source cost centers (A, Shared) legitimately DO require a
    // posted CostAllocationRun once they carry expense in a period.
    const ccIsolated = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cost-centers`))
      .send({ code: `CC-ISOLATED-${run}`, name: 'Isolated for period-close test', departmentId: deptId })
      .expect(201);

    const period = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/periods`))
      .send({ year: 2027, month: 5 })
      .expect(201);

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2027-05-10',
        lines: [
          {
            expenseDate: '2027-05-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 200,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
            costCenterId: ccIsolated.body.id,
          },
        ],
      })
      .expect(201);

    // Still DRAFT — closing must be refused.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/periods/${period.body.id}/close`)).expect(400);

    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 200 },
    ]);

    // Approved but not yet posted — still refused.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/periods/${period.body.id}/close`)).expect(400);

    await postDocument('EXPENSE_CLAIM', claim.body.id, approved.body.version);

    // The 12-month prepaid created earlier still has a PLANNED schedule
    // row for this same period (2027-05) — recognize it first, exactly
    // as a real month-close would, before this period can close.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/prepaids/recognize`))
      .send({ periodYear: 2027, periodMonth: 5 })
      .expect(201);

    const closed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/periods/${period.body.id}/close`)).expect(201);
    expect(closed.body.status).toBe('CLOSED');

    // Already closed — refused a second time.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/periods/${period.body.id}/close`)).expect(400);

    const reopened = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/periods/${period.body.id}/reopen`))
      .send({ reason: 'Late adjustment needed' })
      .expect(201);
    expect(reopened.body.status).toBe('REOPENED');

    const list = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/periods`)).expect(200);
    expect(list.body.some((p: any) => p.id === period.body.id)).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Reports + Health — spec sections 135-147, 126-127
  // ---------------------------------------------------------------------

  it('surfaces the Expense Register and flags an approved-but-unposted claim via the health check', async () => {
    const employmentId = await hireEmployee('Health', 'Check', `PID-${run}-HEALTH`, '2026-01-01');

    const claim = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/expenses/claims`))
      .send({
        employmentId,
        claimDate: '2027-06-10',
        lines: [
          {
            expenseDate: '2027-06-05',
            expenseCategoryId: officeSuppliesCategoryId,
            transactionCurrencyId: aznId,
            transactionAmount: 90,
            paymentSourceType: 'EMPLOYEE_PERSONAL_FUNDS',
            costCenterId: costCenterAId,
          },
        ],
      })
      .expect(201);
    const approved = await submitAndApprove(claim.body.id, claim.body.version, [
      { lineId: claim.body.lines[0].id, approvedAmount: 90 },
    ]);
    // Deliberately left unposted so the health check has something real to flag.

    const register = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/reports/register?fromDate=2027-06-01&toDate=2027-06-30`),
    ).expect(200);
    expect(register.body.some((r: any) => r.claimId === claim.body.id)).toBe(true);

    const health = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/expenses/reports/health`)).expect(200);
    const issue = health.body.find((i: any) => i.code === 'APPROVED_CLAIM_NOT_POSTED' && i.claimId === claim.body.id);
    expect(issue).toBeDefined();
    expect(issue.employmentId).toBe(employmentId);

    // Post it now so it no longer trips health/period-close checks for later runs.
    await postDocument('EXPENSE_CLAIM', claim.body.id, approved.body.version);
  });
});
