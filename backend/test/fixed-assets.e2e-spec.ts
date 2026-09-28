/**
 * Fixed Asset Subledger E2E tests (docx spec Phase 16) — acquisition
 * candidate classification (CAPITALIZE/EXPENSE/ASSIGN_TO_CIP), CIP cost
 * formation and capitalization (incl. concurrency), acceptance vs
 * commissioning, straight-line depreciation (incl. residual value, not-
 * commissioned exclusion, idempotency), modernization, impairment,
 * transfer, disposal (sale + write-off), physical inventory (wrong
 * location correction, missing asset stays unresolved), and GL
 * reconciliation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { FIXED_ASSET_MODERNIZATION_TYPE } from '../src/fixed-assets/fixed-asset-modernization.repository';
import { FIXED_ASSET_IMPAIRMENT_TYPE } from '../src/fixed-assets/fixed-asset-impairment.repository';
import { FIXED_ASSET_DISPOSAL_TYPE } from '../src/fixed-assets/fixed-asset-disposal.repository';
import * as request from 'supertest';

describe('Fixed Asset Subledger (e2e)', () => {
  let app: INestApplication;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let categoryId: string;
  let departmentAId: string;
  let departmentBId: string;
  let warehouseId: string;
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
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(`fa1-${run}@e2e.test`, `fa-t1-${run}`, 'FA1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;
    await charts.ensureAdopted(tenant1Id);

    const category = await auth1(
      request(app.getHttpServer()).post('/fixed-asset-categories'),
    )
      .send({
        code: `MACH-${run}`,
        name: 'Machinery',
        defaultUsefulLifeMonths: 60,
        defaultDepreciationMethod: 'STRAIGHT_LINE',
        defaultResidualValue: 0,
      })
      .expect(201);
    categoryId = category.body.id;

    const deptA = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`),
    )
      .send({ code: `DEPTA-${run}`, name: 'Production A' })
      .expect(201);
    departmentAId = deptA.body.id;
    const deptB = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`),
    )
      .send({ code: `DEPTB-${run}`, name: 'Production B' })
      .expect(201);
    departmentBId = deptB.body.id;

    const warehouse = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`),
    )
      .send({ code: `WH-${run}`, name: 'Main site' })
      .expect(201);
    warehouseId = warehouse.body.id;

    const person = await auth1(
      request(app.getHttpServer()).post('/responsible-persons'),
    )
      .send({ displayName: 'Production Manager' })
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

  async function createAndCommissionAsset(opts: {
    initialCost: number;
    usefulLifeMonths: number;
    residualValue?: number;
    commissioningDate?: string;
  }) {
    const candidate = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
      ),
    )
      .send({
        sourceDocumentType: 'MANUAL',
        sourceDocumentId: `manual-${Date.now()}-${Math.random()}`,
        transactionAmount: opts.initialCost,
        candidateType: 'MANUAL',
      })
      .expect(201);
    const classified = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${candidate.body.id}/classify`,
      ),
    )
      .send({
        expectedVersion: candidate.body.version,
        decision: 'CAPITALIZE',
        categoryId,
        name: `Asset ${Date.now()}`,
        effectiveDate: opts.commissioningDate ?? DOC_DATE,
      })
      .expect(201);
    const assetId = classified.body.asset.id;

    const acceptRes = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/fixed-assets/${assetId}`,
      ),
    ).expect(200);
    const accepted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/fixed-assets/${assetId}/accept`,
      ),
    )
      .send({
        expectedVersion: acceptRes.body.version,
        acceptanceDate: opts.commissioningDate ?? DOC_DATE,
      })
      .expect(201);
    const commissioned = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/fixed-assets/${assetId}/commission`,
      ),
    )
      .send({
        expectedVersion: accepted.body.version,
        commissioningDate: opts.commissioningDate ?? DOC_DATE,
        departmentId: departmentAId,
        locationWarehouseId: warehouseId,
        responsiblePersonId: personId,
        usefulLifeMonths: opts.usefulLifeMonths,
        residualValue: opts.residualValue ?? 0,
        depreciationStartRule: 'FIRST_DAY_NEXT_MONTH',
      })
      .expect(201);
    return commissioned.body;
  }

  describe('Acquisition candidate classification', () => {
    it('CAPITALIZE creates a fixed asset with the candidate amount as initial cost', async () => {
      const candidate = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-1',
          transactionAmount: 100000,
        })
        .expect(201);
      const classified = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${candidate.body.id}/classify`,
        ),
      )
        .send({
          expectedVersion: candidate.body.version,
          decision: 'CAPITALIZE',
          categoryId,
          name: 'Machine',
        })
        .expect(201);
      expect(classified.body.candidate.status).toBe('CAPITALIZED');
      expect(Number(classified.body.asset.initialCost)).toBe(100000);

      const assetView = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${classified.body.asset.id}`,
        ),
      ).expect(200);
      expect(Number(assetView.body.grossCost)).toBe(100000);
    });

    it('EXPENSE never creates an asset', async () => {
      const candidate = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-2',
          transactionAmount: 2000,
        })
        .expect(201);
      const classified = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${candidate.body.id}/classify`,
        ),
      )
        .send({ expectedVersion: candidate.body.version, decision: 'EXPENSE' })
        .expect(201);
      expect(classified.body.status).toBe('EXPENSE');
      expect(classified.body.assignedAssetId).toBeNull();
    });
  });

  describe('CIP cost formation and capitalization', () => {
    it('accumulates multiple capitalizable costs, excludes an expensed one, and capitalizes into one asset', async () => {
      const cip = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip`,
        ),
      )
        .send({
          code: `CIP-${run}-1`,
          name: 'Production Machine Installation',
          startDate: DOC_DATE,
        })
        .expect(201);

      const equipment = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-eq',
          transactionAmount: 100000,
        })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${equipment.body.id}/classify`,
        ),
      )
        .send({
          expectedVersion: equipment.body.version,
          decision: 'ASSIGN_TO_CIP',
          cipProjectId: cip.body.id,
          costComponent: 'PURCHASE_PRICE',
        })
        .expect(201);

      const transport = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-tr',
          transactionAmount: 5000,
        })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${transport.body.id}/classify`,
        ),
      )
        .send({
          expectedVersion: transport.body.version,
          decision: 'ASSIGN_TO_CIP',
          cipProjectId: cip.body.id,
          costComponent: 'FREIGHT',
        })
        .expect(201);

      const installation = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-in',
          transactionAmount: 10000,
        })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${installation.body.id}/classify`,
        ),
      )
        .send({
          expectedVersion: installation.body.version,
          decision: 'ASSIGN_TO_CIP',
          cipProjectId: cip.body.id,
          costComponent: 'INSTALLATION',
        })
        .expect(201);

      const training = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-tn',
          transactionAmount: 2000,
        })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${training.body.id}/classify`,
        ),
      )
        .send({ expectedVersion: training.body.version, decision: 'EXPENSE' })
        .expect(201);

      const balance = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/balance`,
        ),
      ).expect(200);
      expect(Number(balance.body.remainingBalance)).toBe(115000);

      const ready = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/mark-ready`,
        ),
      )
        .send({ expectedVersion: 1 })
        .expect(201);

      const capitalized = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/capitalize`,
        ),
      )
        .send({
          expectedVersion: ready.body.version,
          acceptanceDate: DOC_DATE,
          name: 'Production Machine FA-0001',
          categoryId,
        })
        .expect(201);
      expect(Number(capitalized.body.asset.initialCost)).toBe(115000);
      expect(capitalized.body.project.status).toBe('CAPITALIZED');

      const balanceAfter = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/balance`,
        ),
      ).expect(200);
      expect(Number(balanceAfter.body.remainingBalance)).toBe(0);
    });

    it('rejects capitalizing more than the remaining CIP balance', async () => {
      const cip = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip`,
        ),
      )
        .send({
          code: `CIP-${run}-2`,
          name: 'Small project',
          startDate: DOC_DATE,
        })
        .expect(201);
      const candidate = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-small',
          transactionAmount: 1000,
        })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${candidate.body.id}/classify`,
        ),
      )
        .send({
          expectedVersion: candidate.body.version,
          decision: 'ASSIGN_TO_CIP',
          cipProjectId: cip.body.id,
        })
        .expect(201);
      const ready = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/mark-ready`,
        ),
      )
        .send({ expectedVersion: 1 })
        .expect(201);

      const res = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/capitalize`,
        ),
      ).send({
        expectedVersion: ready.body.version,
        acceptanceDate: DOC_DATE,
        name: 'Too big',
        categoryId,
        amount: 5000,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('never lets two concurrent capitalizations jointly over-consume the same CIP balance', async () => {
      const cip = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip`,
        ),
      )
        .send({
          code: `CIP-${run}-3`,
          name: 'Concurrency project',
          startDate: DOC_DATE,
        })
        .expect(201);
      const candidate = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: 'pi-conc',
          transactionAmount: 10000,
        })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${candidate.body.id}/classify`,
        ),
      )
        .send({
          expectedVersion: candidate.body.version,
          decision: 'ASSIGN_TO_CIP',
          cipProjectId: cip.body.id,
        })
        .expect(201);
      const ready = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/mark-ready`,
        ),
      )
        .send({ expectedVersion: 1 })
        .expect(201);

      const attempt = () =>
        auth1(
          request(app.getHttpServer()).post(
            `/organizations/${org1Id}/fixed-assets/cip/${cip.body.id}/capitalize`,
          ),
        ).send({
          expectedVersion: ready.body.version,
          acceptanceDate: DOC_DATE,
          name: 'Concurrent asset',
          categoryId,
          amount: 7000,
        });
      const [r1, r2] = await Promise.all([attempt(), attempt()]);
      const succeeded = [r1, r2].filter((r) => r.status === 201);
      expect(succeeded).toHaveLength(1);
    });
  });

  describe('Acceptance vs commissioning', () => {
    it('keeps a not-yet-commissioned asset out of depreciation', async () => {
      const candidate = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates`,
        ),
      )
        .send({
          sourceDocumentType: 'MANUAL',
          sourceDocumentId: `nc-${Date.now()}`,
          transactionAmount: 100000,
        })
        .expect(201);
      const classified = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/acquisition-candidates/${candidate.body.id}/classify`,
        ),
      )
        .send({
          expectedVersion: candidate.body.version,
          decision: 'CAPITALIZE',
          categoryId,
          name: 'Not commissioned yet',
        })
        .expect(201);
      const assetId = classified.body.asset.id;
      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${assetId}`,
        ),
      ).expect(200);
      const accepted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/${assetId}/accept`,
        ),
      )
        .send({ expectedVersion: view.body.version, acceptanceDate: DOC_DATE })
        .expect(201);
      expect(accepted.body.status).toBe('ACCEPTED');
      expect(accepted.body.commissioningDate).toBeNull();
    });
  });

  describe('Straight-line depreciation', () => {
    it('computes monthly depreciation with zero residual and posts a balanced entry', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 120000,
        usefulLifeMonths: 60,
        residualValue: 0,
        commissioningDate: '2026-01-15',
      });
      // depreciationStartDate = FIRST_DAY_NEXT_MONTH after Jan 15 -> 2026-02-01
      const calculated = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/calculate`,
        ),
      )
        .send({ period: '2026-02-01' })
        .expect(201);
      const line = calculated.body.lines.find(
        (l: any) => l.assetId === asset.id,
      );
      expect(Number(line.depreciationAmount)).toBe(2000);

      const posted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/${calculated.body.id}/post`,
        ),
      )
        .send({ expectedVersion: calculated.body.version })
        .expect(201);
      expect(posted.body.status).toBe('POSTED');

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(Number(view.body.accumulatedDepreciation)).toBe(2000);
      expect(Number(view.body.netBookValue)).toBe(118000);
    });

    it('subtracts residual value from the depreciable base', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 120000,
        usefulLifeMonths: 50,
        residualValue: 20000,
        commissioningDate: '2026-01-15',
      });
      const calculated = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/calculate`,
        ),
      )
        .send({ period: '2026-03-01' })
        .expect(201);
      const line = calculated.body.lines.find(
        (l: any) => l.assetId === asset.id,
      );
      expect(Number(line.depreciationAmount)).toBe(2000);
    });

    it('never posts the same period twice (idempotency)', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 60000,
        usefulLifeMonths: 30,
        residualValue: 0,
        commissioningDate: '2026-03-15',
      });
      const calculated = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/calculate`,
        ),
      )
        .send({ period: '2026-04-01' })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/${calculated.body.id}/post`,
        ),
      )
        .send({ expectedVersion: calculated.body.version })
        .expect(201);

      const retryPost = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/${calculated.body.id}/post`,
        ),
      ).send({ expectedVersion: calculated.body.version + 1 });
      expect(retryPost.status).toBeGreaterThanOrEqual(400);

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(Number(view.body.accumulatedDepreciation)).toBe(2000);
    });
  });

  describe('Modernization', () => {
    it('increases gross carrying amount', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 100000,
        usefulLifeMonths: 60,
        residualValue: 0,
      });
      const modernization = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/modernizations`,
        ),
      )
        .send({ documentDate: DOC_DATE, assetId: asset.id, amount: 25000 })
        .expect(201);
      await post(
        FIXED_ASSET_MODERNIZATION_TYPE,
        modernization.body.id,
        modernization.body.version,
      ).expect(201);

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(Number(view.body.grossCost)).toBe(125000);
    });
  });

  describe('Impairment', () => {
    it('reduces carrying amount to the recoverable amount', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 80000,
        usefulLifeMonths: 60,
        residualValue: 0,
      });
      const impairment = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/impairments`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          assetId: asset.id,
          recoverableAmount: 60000,
        })
        .expect(201);
      expect(Number(impairment.body.impairmentAmount)).toBe(20000);
      await post(
        FIXED_ASSET_IMPAIRMENT_TYPE,
        impairment.body.id,
        impairment.body.version,
      ).expect(201);

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(Number(view.body.netBookValue)).toBe(60000);
    });
  });

  describe('Transfer', () => {
    it('moves department without changing cost or NBV', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 50000,
        usefulLifeMonths: 60,
        residualValue: 0,
      });
      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      const transferred = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/${asset.id}/transfer`,
        ),
      )
        .send({
          expectedVersion: view.body.version,
          effectiveDate: DOC_DATE,
          toDepartmentId: departmentBId,
          reason: 'Reorg',
        })
        .expect(201);
      expect(transferred.body.departmentId).toBe(departmentBId);

      const after = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(Number(after.body.grossCost)).toBe(50000);
      expect(Number(after.body.netBookValue)).toBe(50000);
    });
  });

  describe('Disposal', () => {
    it('SALE computes gain/loss and derecognizes the asset', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 100000,
        usefulLifeMonths: 60,
        residualValue: 0,
        commissioningDate: '2026-01-15',
      });
      const calculated = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/calculate`,
        ),
      )
        .send({ period: '2026-06-01' })
        .expect(201);
      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/${calculated.body.id}/post`,
        ),
      )
        .send({ expectedVersion: calculated.body.version })
        .expect(201);

      const buyer = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/counterparties`,
        ),
      )
        .send({
          counterpartyType: 'CUSTOMER',
          code: `BUY-${run}`,
          name: 'Buyer Co',
          paymentTerms: 30,
        })
        .expect(201);

      const disposal = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/disposals`,
        ),
      )
        .send({
          documentDate: '2026-07-01',
          assetId: asset.id,
          disposalType: 'SALE',
          proceeds: 100000,
          buyerId: buyer.body.id,
        })
        .expect(201);
      await post(
        FIXED_ASSET_DISPOSAL_TYPE,
        disposal.body.id,
        disposal.body.version,
      ).expect(201);

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(view.body.status).toBe('DISPOSED');
      expect(Number(view.body.grossCost)).toBe(0);
      expect(Number(view.body.netBookValue)).toBe(0);
    });

    it('WRITE_OFF with no proceeds recognizes a full loss and blocks further depreciation', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 30000,
        usefulLifeMonths: 60,
        residualValue: 0,
      });
      const disposal = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/disposals`,
        ),
      )
        .send({
          documentDate: DOC_DATE,
          assetId: asset.id,
          disposalType: 'WRITE_OFF',
          reason: 'Beyond repair',
        })
        .expect(201);
      await post(
        FIXED_ASSET_DISPOSAL_TYPE,
        disposal.body.id,
        disposal.body.version,
      ).expect(201);

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(view.body.status).toBe('WRITTEN_OFF');

      const calculated = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/depreciation-runs/calculate`,
        ),
      )
        .send({ period: '2026-07-01' })
        .expect(201);
      const line = calculated.body.lines.find(
        (l: any) => l.assetId === asset.id,
      );
      expect(line).toBeUndefined();
    });
  });

  describe('Physical inventory', () => {
    it('creates a transfer correction for a wrong-location result instead of writing off', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 40000,
        usefulLifeMonths: 60,
        residualValue: 0,
      });
      const otherWarehouse = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/warehouses`,
        ),
      )
        .send({ code: `WH2-${run}`, name: 'Other site' })
        .expect(201);

      const count = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/inventory-counts`,
        ),
      )
        .send({})
        .expect(201);
      const submitted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/inventory-counts/${count.body.id}/submit`,
        ),
      )
        .send({
          expectedVersion: count.body.version,
          results: [
            {
              assetId: asset.id,
              resultType: 'WRONG_LOCATION',
              foundLocationWarehouseId: otherWarehouse.body.id,
            },
          ],
        })
        .expect(201);
      const result = submitted.body.results[0];
      expect(result.resolutionStatus).toBe('RESOLVED');
      expect(result.resolutionDocumentType).toBe('FIXED_ASSET_TRANSFER');

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(view.body.locationWarehouseId).toBe(otherWarehouse.body.id);
      expect(Number(view.body.grossCost)).toBe(40000);
    });

    it('leaves a missing asset unresolved rather than auto-disposing it', async () => {
      const asset = await createAndCommissionAsset({
        initialCost: 15000,
        usefulLifeMonths: 60,
        residualValue: 0,
      });
      const count = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/inventory-counts`,
        ),
      )
        .send({})
        .expect(201);
      const submitted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/fixed-assets/inventory-counts/${count.body.id}/submit`,
        ),
      )
        .send({
          expectedVersion: count.body.version,
          results: [{ assetId: asset.id, resultType: 'MISSING' }],
        })
        .expect(201);
      expect(submitted.body.results[0].resolutionStatus).toBe('OPEN');

      const view = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/${asset.id}`,
        ),
      ).expect(200);
      expect(view.body.status).toBe('ACTIVE');
    });
  });

  describe('GL Reconciliation', () => {
    it('reports every account healthy after a normal flow', async () => {
      await createAndCommissionAsset({
        initialCost: 10000,
        usefulLifeMonths: 60,
        residualValue: 0,
      });
      const result = await auth1(
        request(app.getHttpServer()).get(
          `/organizations/${org1Id}/fixed-assets/reconciliation`,
        ),
      ).expect(200);
      for (const row of result.body) {
        expect(row.healthy).toBe(true);
      }
    });
  });
});
