/**
 * Cash Desk Engine E2E tests (docx spec Phase 15) — CashDeskTransfer
 * (INSTANT/TWO_STEP + partial receive), negative-balance control incl.
 * concurrency, cashier assignment enforcement, employee advance/return,
 * physical count -> adjustment resolution chain, daily close, cashier
 * handover, and the health/reporting read models.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { CASH_TRANSACTION_TYPE } from '../src/treasury/cash-transaction.repository';
import { CASH_DESK_TRANSFER_TYPE } from '../src/cash-desk/cash-desk-transfer.repository';
import { CASH_COUNT_ADJUSTMENT_TYPE } from '../src/cash-desk/cash-count-adjustment.repository';
import * as request from 'supertest';
import Decimal from 'decimal.js';

describe('Cash Desk Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let aznId: string;
  let cashboxAId: string;
  let cashboxBId: string;
  let personId: string;

  const DOC_DATE = '2026-06-01';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(
      `cdesk1-${run}@e2e.test`,
      `cdesk-t1-${run}`,
      'CD1',
    );
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;
    await charts.ensureAdopted(tenant1Id);

    const currencies = await auth1(
      request(app.getHttpServer()).get('/currencies'),
    ).expect(200);
    aznId = currencies.body.find((c: any) => c.code === 'AZN').id;

    const cashboxA = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
    )
      .send({ code: `CDA-${run}`, name: 'Main cash desk', currencyId: aznId })
      .expect(201);
    cashboxAId = cashboxA.body.id;

    const cashboxB = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
    )
      .send({
        code: `CDB-${run}`,
        name: 'Secondary cash desk',
        currencyId: aznId,
      })
      .expect(201);
    cashboxBId = cashboxB.body.id;

    const person = await auth1(
      request(app.getHttpServer()).post('/responsible-persons'),
    )
      .send({ displayName: 'Cashier One' })
      .expect(201);
    personId = person.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupTenant(
    email: string,
    tenantCode: string,
    orgCode: string,
  ) {
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Test1234!', displayName: 'Test User' })
      .expect(201);
    const token = regRes.body.accessToken;
    const tenantRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: tenantCode,
        name: `${tenantCode} Corp`,
        baseCurrencyCode: 'AZN',
      })
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
    return req
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-Id', tenant1Id);
  }

  function post(documentType: string, id: string, expectedVersion: number) {
    return auth1(
      request(app.getHttpServer()).post(
        `/documents/${documentType}/${id}/post`,
      ),
    ).send({ expectedVersion });
  }

  function unpost(documentType: string, id: string, expectedVersion: number) {
    return auth1(
      request(app.getHttpServer()).post(
        `/documents/${documentType}/${id}/unpost`,
      ),
    ).send({ expectedVersion });
  }

  async function receipt(
    cashboxId: string,
    amount: number,
    category = 'OTHER_INCOME',
  ) {
    const created = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/cash-transactions`,
      ),
    )
      .send({
        documentDate: DOC_DATE,
        cashboxId,
        direction: 'RECEIPT',
        category,
        amount,
      })
      .expect(201);
    const posted = await post(
      CASH_TRANSACTION_TYPE,
      created.body.id,
      created.body.version,
    ).expect(201);
    return { id: created.body.id, version: posted.body.version };
  }

  async function balanceOf(cashboxId: string): Promise<string> {
    const res = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/cash-desk-reports/balances`,
      ),
    ).expect(200);
    return res.body.find((r: any) => r.cashboxId === cashboxId)?.balance;
  }

  describe('Basic receipt/expense + negative balance control', () => {
    it('posts a receipt and an expense, moving the book balance', async () => {
      await receipt(cashboxAId, 500);
      const expense = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-transactions`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          cashboxId: cashboxAId,
          direction: 'PAYMENT',
          category: 'OTHER_EXPENSE',
          amount: 200,
        })
        .expect(201);
      await post(
        CASH_TRANSACTION_TYPE,
        expense.body.id,
        expense.body.version,
      ).expect(201);
      expect(await balanceOf(cashboxAId)).toBe('300.00');
    });

    it('blocks an expense that would drive a NEVER-policy cashbox negative', async () => {
      const expense = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-transactions`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          cashboxId: cashboxAId,
          direction: 'PAYMENT',
          category: 'OTHER_EXPENSE',
          amount: 999999,
        })
        .expect(201);
      const res = await post(
        CASH_TRANSACTION_TYPE,
        expense.body.id,
        expense.body.version,
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('never lets two concurrent expenses jointly overdraw the same cash desk', async () => {
      const box = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
      )
        .send({
          code: `CDC-${run}`,
          name: 'Concurrency cash desk',
          currencyId: aznId,
        })
        .expect(201);
      await receipt(box.body.id, 1000);

      const attempt = async (amount: number) => {
        const created = await auth1(
          request(app.getHttpServer()).post(
            `/organizations/${org1Id}/cash-transactions`,
          ),
        )
          .send({
            documentDate: DOC_DATE,
            cashboxId: box.body.id,
            direction: 'PAYMENT',
            category: 'OTHER_EXPENSE',
            amount,
          })
          .expect(201);
        return post(
          CASH_TRANSACTION_TYPE,
          created.body.id,
          created.body.version,
        );
      };
      const [r1, r2] = await Promise.all([attempt(700), attempt(600)]);
      const succeeded = [r1, r2].filter((r) => r.status === 201);
      expect(succeeded).toHaveLength(1);
    });

    it('allows an ALLOWED-policy cashbox to go negative', async () => {
      const box = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
      )
        .send({
          code: `CDD-${run}`,
          name: 'Allowed-negative desk',
          currencyId: aznId,
        })
        .expect(201);
      await prisma.cashbox.update({
        where: { id: box.body.id },
        data: { negativeBalancePolicy: 'ALLOWED' },
      });

      const expense = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-transactions`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          cashboxId: box.body.id,
          direction: 'PAYMENT',
          category: 'OTHER_EXPENSE',
          amount: 50,
        })
        .expect(201);
      await post(
        CASH_TRANSACTION_TYPE,
        expense.body.id,
        expense.body.version,
      ).expect(201);
      expect(await balanceOf(box.body.id)).toBe('-50.00');
    });
  });

  describe('Cashier assignment enforcement', () => {
    it('rejects posting with a cashierId that has no active assignment, then allows it once assigned', async () => {
      const created = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-transactions`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          cashboxId: cashboxAId,
          direction: 'RECEIPT',
          category: 'OTHER_INCOME',
          amount: 10,
          cashierId: personId,
        })
        .expect(201);
      const blocked = await post(
        CASH_TRANSACTION_TYPE,
        created.body.id,
        created.body.version,
      );
      expect(blocked.status).toBeGreaterThanOrEqual(400);

      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cashier-assignments`,
        ),
      )
        .send({ cashboxId: cashboxAId, personId, validFrom: '2026-01-01' })
        .expect(201);

      const posted = await post(
        CASH_TRANSACTION_TYPE,
        created.body.id,
        created.body.version,
      );
      expect(posted.status).toBe(201);
    });
  });

  describe('Employee advance / return', () => {
    it('records an advance receivable and clears it on return', async () => {
      const advance = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-transactions`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          cashboxId: cashboxAId,
          direction: 'PAYMENT',
          category: 'EMPLOYEE_ADVANCE',
          amount: 150,
          employeeId: personId,
        })
        .expect(201);
      await post(
        CASH_TRANSACTION_TYPE,
        advance.body.id,
        advance.body.version,
      ).expect(201);

      const balance = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/accountable-persons/${personId}/balance`,
        ),
      ).expect(200);
      expect(
        balance.body.find((r: any) => r.currencyId === aznId)?.outstanding,
      ).toBe('150.00');

      const ret = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-transactions`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          cashboxId: cashboxAId,
          direction: 'RECEIPT',
          category: 'EMPLOYEE_ADVANCE_RETURN',
          amount: 150,
          employeeId: personId,
        })
        .expect(201);
      await post(CASH_TRANSACTION_TYPE, ret.body.id, ret.body.version).expect(
        201,
      );

      const balance2 = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/accountable-persons/${personId}/balance`,
        ),
      ).expect(200);
      expect(
        balance2.body.find((r: any) => r.currencyId === aznId)?.outstanding,
      ).toBe('0.00');
    });

    it('rejects an EMPLOYEE_ADVANCE with no employeeId', async () => {
      const res = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-transactions`,
        ),
      ).send({
        documentDate: DOC_DATE,
        cashboxId: cashboxAId,
        direction: 'PAYMENT',
        category: 'EMPLOYEE_ADVANCE',
        amount: 50,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('CashDeskTransfer', () => {
    it('INSTANT: moves money between two desks in one step', async () => {
      await receipt(cashboxAId, 1000);
      const beforeA = await balanceOf(cashboxAId);
      const beforeB = await balanceOf(cashboxBId);

      const transfer = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-transfers`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          sourceCashboxId: cashboxAId,
          destinationCashboxId: cashboxBId,
          amount: 300,
          transferMode: 'INSTANT',
        })
        .expect(201);
      await post(
        CASH_DESK_TRANSFER_TYPE,
        transfer.body.id,
        transfer.body.version,
      ).expect(201);

      expect(await balanceOf(cashboxAId)).toBe(
        (Number(beforeA) - 300).toFixed(2),
      );
      expect(await balanceOf(cashboxBId)).toBe(
        (Number(beforeB) + 300).toFixed(2),
      );

      const fetched = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/cash-desk-transfers/${transfer.body.id}`,
        ),
      ).expect(200);
      expect(fetched.body.transferState).toBe('RECEIVED');
    });

    it('TWO_STEP: ships on post, arrives via two partial receives, and blocks unpost once received', async () => {
      await receipt(cashboxAId, 1000);
      const beforeA = await balanceOf(cashboxAId);

      const transfer = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-transfers`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          sourceCashboxId: cashboxAId,
          destinationCashboxId: cashboxBId,
          amount: 400,
          transferMode: 'TWO_STEP',
        })
        .expect(201);
      const postedShip = await post(
        CASH_DESK_TRANSFER_TYPE,
        transfer.body.id,
        transfer.body.version,
      ).expect(201);

      // Source already debited; destination not yet credited.
      expect(await balanceOf(cashboxAId)).toBe(
        (Number(beforeA) - 400).toFixed(2),
      );
      const midway = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/cash-desk-transfers/${transfer.body.id}`,
        ),
      ).expect(200);
      expect(midway.body.transferState).toBe('IN_TRANSIT');

      const beforeB = await balanceOf(cashboxBId);
      const receive1 = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-transfers/${transfer.body.id}/receive`,
        ),
      )
        .send({ expectedVersion: postedShip.body.version, amount: 150 })
        .expect(201);
      expect(receive1.body.transferState).toBe('PARTIALLY_RECEIVED');
      expect(await balanceOf(cashboxBId)).toBe(
        (Number(beforeB) + 150).toFixed(2),
      );

      // Cannot unpost once partially received.
      const blockedUnpost = await unpost(
        CASH_DESK_TRANSFER_TYPE,
        transfer.body.id,
        receive1.body.version,
      );
      expect(blockedUnpost.status).toBeGreaterThanOrEqual(400);

      const receive2 = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-transfers/${transfer.body.id}/receive`,
        ),
      )
        .send({ expectedVersion: receive1.body.version })
        .expect(201);
      expect(receive2.body.transferState).toBe('RECEIVED');
      expect(await balanceOf(cashboxBId)).toBe(
        (Number(beforeB) + 400).toFixed(2),
      );

      // A third receive attempt is rejected — nothing left to receive.
      const overReceive = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-transfers/${transfer.body.id}/receive`,
        ),
      ).send({ expectedVersion: receive2.body.version, amount: 1 });
      expect(overReceive.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects the same cash desk on both sides', async () => {
      const res = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-transfers`,
        ),
      ).send({
        documentDate: DOC_DATE,
        sourceCashboxId: cashboxAId,
        destinationCashboxId: cashboxAId,
        amount: 10,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Physical count -> adjustment resolution chain', () => {
    it('detects a shortage, resolves it via a posted CashCountAdjustment, and clears the difference report', async () => {
      const box = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
      )
        .send({ code: `CDE-${run}`, name: 'Count desk', currencyId: aznId })
        .expect(201);
      await receipt(box.body.id, 500);
      const bookBalance = await balanceOf(box.body.id);
      expect(bookBalance).toBe('500.00');

      const count = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts`,
        ),
      )
        .send({ cashboxId: box.body.id })
        .expect(201);
      expect(Number(count.body.bookBalance)).toBe(500);

      const submitted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/submit`,
        ),
      )
        .send({
          expectedVersion: count.body.version,
          lines: [{ faceValue: 50, quantity: 9 }],
        }) // 450 counted vs 500 book -> -50 shortage
        .expect(201);
      expect(Number(submitted.body.difference)).toBe(-50);

      const approved = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/approve`,
        ),
      )
        .send({ expectedVersion: submitted.body.version })
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');

      const adjustment = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-count-adjustments`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          countId: count.body.id,
          adjustmentType: 'CASH_SHORTAGE',
        })
        .expect(201);
      expect(Number(adjustment.body.amount)).toBe(50);

      await post(
        CASH_COUNT_ADJUSTMENT_TYPE,
        adjustment.body.id,
        adjustment.body.version,
      ).expect(201);
      expect(await balanceOf(box.body.id)).toBe('450.00');

      const differences = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/cash-desk-reports/differences`,
        ),
      ).expect(200);
      const row = differences.body.find(
        (r: any) => r.countId === count.body.id,
      );
      expect(row.adjustmentStatus).toBe('POSTED');
    });

    it('charges a CASHIER_RECEIVABLE shortage to the responsible person', async () => {
      const box = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
      )
        .send({
          code: `CDF-${run}`,
          name: 'Receivable desk',
          currencyId: aznId,
        })
        .expect(201);
      await receipt(box.body.id, 200);

      const count = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts`,
        ),
      )
        .send({ cashboxId: box.body.id })
        .expect(201);
      const submitted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/submit`,
        ),
      )
        .send({
          expectedVersion: count.body.version,
          lines: [{ faceValue: 50, quantity: 3 }],
        }) // 150 vs 200 -> -50
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/approve`,
        ),
      )
        .send({ expectedVersion: submitted.body.version })
        .expect(201);

      const adjustment = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-count-adjustments`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          countId: count.body.id,
          adjustmentType: 'CASHIER_RECEIVABLE',
          responsiblePersonId: personId,
        })
        .expect(201);
      await post(
        CASH_COUNT_ADJUSTMENT_TYPE,
        adjustment.body.id,
        adjustment.body.version,
      ).expect(201);

      const balance = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/accountable-persons/${personId}/balance`,
        ),
      ).expect(200);
      const outstanding = new Decimal(
        balance.body.find((r: any) => r.currencyId === aznId)?.outstanding ??
          '0',
      );
      expect(outstanding.gte('50')).toBe(true);
    });
  });

  describe('Daily close', () => {
    it('gates close on an unresolved count difference, then closes once resolved', async () => {
      const box = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
      )
        .send({
          code: `CDG-${run}`,
          name: 'Daily close desk',
          currencyId: aznId,
        })
        .expect(201);
      await prisma.cashbox.update({
        where: { id: box.body.id },
        data: { requireDenominationCount: true },
      });
      await receipt(box.body.id, 100);

      const daily = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-daily-closes`,
        ),
      )
        .send({ cashboxId: box.body.id, businessDate: DOC_DATE })
        .expect(201);

      const refreshed = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-daily-closes/${daily.body.id}/refresh`,
        ),
      ).expect(201);
      expect(refreshed.body.status).toBe('COUNT_REQUIRED');

      const closeBlocked = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-daily-closes/${daily.body.id}/close`,
        ),
      ).send({ expectedVersion: refreshed.body.version });
      expect(closeBlocked.status).toBeGreaterThanOrEqual(400);

      const count = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts`,
        ),
      )
        .send({ cashboxId: box.body.id })
        .expect(201);
      const submitted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/submit`,
        ),
      )
        .send({
          expectedVersion: count.body.version,
          lines: [{ faceValue: 100, quantity: 1 }],
        }) // matches book exactly
        .expect(201);
      expect(Number(submitted.body.difference)).toBe(0);
      const approvedCount = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/approve`,
        ),
      )
        .send({ expectedVersion: submitted.body.version })
        .expect(201);

      const linked = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-daily-closes/${daily.body.id}/link-count`,
        ),
      )
        .send({
          expectedVersion: refreshed.body.version,
          physicalCountId: approvedCount.body.id,
        })
        .expect(201);
      expect(linked.body.status).toBe('OPEN');

      const closed = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-daily-closes/${daily.body.id}/close`,
        ),
      )
        .send({ expectedVersion: linked.body.version })
        .expect(201);
      expect(closed.body.status).toBe('CLOSED');

      const reopened = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-desk-daily-closes/${daily.body.id}/reopen`,
        ),
      )
        .send({
          expectedVersion: closed.body.version,
          reason: 'Found a late document',
        })
        .expect(201);
      expect(reopened.body.status).toBe('REOPENED');
    });
  });

  describe('Cashier handover', () => {
    it('blocks completion while a linked count difference is unresolved, allows it once posted', async () => {
      const box = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
      )
        .send({ code: `CDH-${run}`, name: 'Handover desk', currencyId: aznId })
        .expect(201);
      await receipt(box.body.id, 300);

      const outgoing = await auth1(
        request(app.getHttpServer()).post('/responsible-persons'),
      )
        .send({ displayName: 'Outgoing Cashier' })
        .expect(201);
      const incoming = await auth1(
        request(app.getHttpServer()).post('/responsible-persons'),
      )
        .send({ displayName: 'Incoming Cashier' })
        .expect(201);

      const count = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts`,
        ),
      )
        .send({ cashboxId: box.body.id })
        .expect(201);
      const submitted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/submit`,
        ),
      )
        .send({
          expectedVersion: count.body.version,
          lines: [{ faceValue: 50, quantity: 5 }],
        }) // 250 vs 300 -> -50
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-physical-counts/${count.body.id}/approve`,
        ),
      )
        .send({ expectedVersion: submitted.body.version })
        .expect(201);

      const handover = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cashier-handovers`,
        ),
      )
        .send({
          cashboxId: box.body.id,
          outgoingCashierId: outgoing.body.id,
          incomingCashierId: incoming.body.id,
          denominationCountId: count.body.id,
        })
        .expect(201);
      expect(handover.body.status).toBe('PENDING_RESOLUTION');

      const blocked = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cashier-handovers/${handover.body.id}/complete`,
        ),
      ).send({ expectedVersion: handover.body.version });
      expect(blocked.status).toBeGreaterThanOrEqual(400);

      const adjustment = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cash-count-adjustments`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          countId: count.body.id,
          adjustmentType: 'CASH_SHORTAGE',
        })
        .expect(201);
      await post(
        CASH_COUNT_ADJUSTMENT_TYPE,
        adjustment.body.id,
        adjustment.body.version,
      ).expect(201);

      const completed = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/cashier-handovers/${handover.body.id}/complete`,
        ),
      )
        .send({ expectedVersion: handover.body.version })
        .expect(201);
      expect(completed.body.status).toBe('COMPLETE');
    });
  });

  describe('Cash Health', () => {
    it('reports no book-vs-GL mismatch for a healthy cashbox', async () => {
      const box = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`),
      )
        .send({ code: `CDI-${run}`, name: 'Healthy desk', currencyId: aznId })
        .expect(201);
      await receipt(box.body.id, 77);

      const health = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/cash-desk-health`,
        ),
      ).expect(200);
      const mismatch = health.body.find(
        (i: any) =>
          i.code === 'CASH_BOOK_GL_MISMATCH' && i.cashboxId === box.body.id,
      );
      expect(mismatch).toBeUndefined();
    });
  });
});
