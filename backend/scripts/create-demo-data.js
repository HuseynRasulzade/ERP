/**
 * One-shot demo data seeder for local development (run against a running
 * backend — `npm run start:dev` in another terminal first).
 *
 * Creates (idempotent — safe to re-run):
 *   - a demo login (email/password printed at the end)
 *   - a tenant + organization, with the chart of accounts and VAT
 *     localization adopted (required before posting anything with a GL/tax
 *     consequence)
 *   - a warehouse, a unit of measure, a supplier, two products
 *   - two posted Goods Receipts (so there is real stock to work with)
 *   - an Inventory Count Plan, scoped to the warehouse and marked READY,
 *     so the Inventory Count screens have something to click into
 *     immediately after login
 *
 * Usage:
 *   node scripts/create-demo-data.js
 *   API_URL=http://localhost:3000 node scripts/create-demo-data.js
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@erp.local';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo1234!';
const DEMO_TENANT_CODE = process.env.DEMO_TENANT_CODE ?? 'demo-erp-count';
const DEMO_ORG_CODE = 'DEMO-ORG';

let accessToken = null;
let tenantId = null;

async function call(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken && !opts.skipAuth) headers.Authorization = `Bearer ${accessToken}`;
  if (tenantId && !opts.skipTenant) headers['X-Tenant-Id'] = tenantId;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  return { status: res.status, body: json };
}

async function ensureUserAndLogin() {
  const reg = await call('POST', '/auth/register', { email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: 'Demo Admin' }, { skipAuth: true, skipTenant: true });
  if (reg.status === 201) {
    accessToken = reg.body.accessToken;
    console.log(`Created demo user ${DEMO_EMAIL}`);
    return;
  }
  // Already exists (e.g. re-run) — log in instead.
  const login = await call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD }, { skipAuth: true, skipTenant: true });
  if (login.status !== 201 && login.status !== 200) {
    throw new Error(`Could not register or log in as ${DEMO_EMAIL}: ${JSON.stringify(login.body)}`);
  }
  accessToken = login.body.accessToken;
  console.log(`Demo user ${DEMO_EMAIL} already existed — logged in`);
}

async function ensureTenantAndOrg() {
  const mine = await call('GET', '/users/me/tenants', undefined, { skipTenant: true });
  const existing = mine.body.find((t) => t.tenantCode === DEMO_TENANT_CODE);
  if (existing) {
    tenantId = existing.tenantId;
    console.log(`Using existing tenant ${DEMO_TENANT_CODE} (${tenantId})`);
  } else {
    const created = await call('POST', '/tenants', { code: DEMO_TENANT_CODE, name: 'Demo Corp', baseCurrencyCode: 'USD' }, { skipTenant: true });
    if (created.status === 409) {
      throw new Error(
        `Tenant code "${DEMO_TENANT_CODE}" is already taken by a DIFFERENT account (tenant codes are global). ` +
          `Re-run with a different code, e.g.: DEMO_TENANT_CODE=demo-erp-count-2 node scripts/create-demo-data.js`,
      );
    }
    if (created.status !== 201) throw new Error(`Could not create tenant: ${JSON.stringify(created.body)}`);
    tenantId = created.body.id;
    console.log(`Created tenant ${DEMO_TENANT_CODE} (${tenantId})`);
  }

  const orgs = await call('GET', '/organizations');
  let org = orgs.body.find((o) => o.code === DEMO_ORG_CODE);
  if (!org) {
    const created = await call('POST', '/organizations', { code: DEMO_ORG_CODE, name: 'Demo Organization' });
    if (created.status !== 201) throw new Error(`Could not create organization: ${JSON.stringify(created.body)}`);
    org = created.body;
    console.log(`Created organization ${DEMO_ORG_CODE} (${org.id})`);
  } else {
    console.log(`Using existing organization ${DEMO_ORG_CODE} (${org.id})`);
  }
  return org.id;
}

async function ensureOrCreate(getPath, matchFn, createPath, createBody, label) {
  const list = await call('GET', getPath);
  const existing = Array.isArray(list.body) ? list.body.find(matchFn) : null;
  if (existing) {
    console.log(`Using existing ${label} (${existing.id})`);
    return existing;
  }
  const created = await call('POST', createPath, createBody);
  if (created.status !== 201) throw new Error(`Could not create ${label}: ${JSON.stringify(created.body)}`);
  console.log(`Created ${label} (${created.body.id})`);
  return created.body;
}

async function main() {
  console.log(`Seeding demo data against ${API_URL} ...`);
  await ensureUserAndLogin();
  const orgId = await ensureTenantAndOrg();

  await call('POST', '/accounting/chart/adopt');
  await call('POST', '/tax/localization/seed');
  console.log('Chart of accounts + VAT localization adopted');

  const unit = await ensureOrCreate('/units-of-measure', (u) => u.code === 'PCS', '/units-of-measure', { code: 'PCS', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' }, 'unit of measure PCS');

  const warehouse = await ensureOrCreate(`/organizations/${orgId}/warehouses`, (w) => w.code === 'WH-MAIN', `/organizations/${orgId}/warehouses`, { code: 'WH-MAIN', name: 'Main Warehouse' }, 'warehouse WH-MAIN');

  const supplier = await ensureOrCreate(
    `/organizations/${orgId}/counterparties`,
    (c) => c.code === 'SUP-DEMO',
    `/organizations/${orgId}/counterparties`,
    { counterpartyType: 'SUPPLIER', code: 'SUP-DEMO', name: 'Demo Supplier', paymentTerms: 30 },
    'supplier SUP-DEMO',
  );

  const productA = await ensureOrCreate(
    `/organizations/${orgId}/products`,
    (p) => p.code === 'LAPTOP-X1',
    `/organizations/${orgId}/products`,
    { code: 'LAPTOP-X1', name: 'Laptop X1', productType: 'GOODS', baseUnitId: unit.id },
    'product LAPTOP-X1',
  );
  const productB = await ensureOrCreate(
    `/organizations/${orgId}/products`,
    (p) => p.code === 'MOUSE-M2',
    `/organizations/${orgId}/products`,
    { code: 'MOUSE-M2', name: 'Mouse M2', productType: 'GOODS', baseUnitId: unit.id },
    'product MOUSE-M2',
  );

  const receipts = await call('GET', `/organizations/${orgId}/goods-receipts`);
  if (!receipts.body || receipts.body.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    for (const [product, qty, price] of [[productA, 25, 900], [productB, 80, 15]]) {
      const gr = await call('POST', `/organizations/${orgId}/goods-receipts`, {
        counterpartyId: supplier.id,
        warehouseId: warehouse.id,
        documentDate: today,
        lines: [{ productId: product.id, unitId: unit.id, quantity: qty, price }],
      });
      if (gr.status !== 201) throw new Error(`Could not create goods receipt: ${JSON.stringify(gr.body)}`);
      const posted = await call('POST', `/documents/GOODS_RECEIPT/${gr.body.id}/post`, { expectedVersion: gr.body.version });
      console.log(`Posted goods receipt for ${product.code}: ${qty} units — ${posted.body.postingStatus ?? JSON.stringify(posted.body)}`);
    }
  } else {
    console.log(`${receipts.body.length} goods receipt(s) already exist — skipping stock seeding`);
  }

  const plans = await call('GET', `/organizations/${orgId}/inventory-count/plans`);
  if (!plans.body || plans.body.length === 0) {
    const plan = await call('POST', `/organizations/${orgId}/inventory-count/plans`, {
      planDate: new Date().toISOString().slice(0, 10),
      countType: 'FULL',
      reason: 'Demo physical count',
      scopes: [{ includeExclude: 'INCLUDE', warehouseId: warehouse.id }],
    });
    if (plan.status !== 201) throw new Error(`Could not create count plan: ${JSON.stringify(plan.body)}`);
    await call('POST', `/organizations/${orgId}/inventory-count/plans/${plan.body.id}/mark-ready`, { expectedVersion: plan.body.version });
    console.log(`Created and readied Inventory Count Plan ${plan.body.number}`);
  } else {
    console.log(`${plans.body.length} inventory count plan(s) already exist — skipping`);
  }

  console.log('\n=================================================');
  console.log('Demo data ready. Log in to the frontend with:');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`  Tenant:   Demo Corp (${DEMO_TENANT_CODE})`);
  console.log(`  Org:      Demo Organization (${DEMO_ORG_CODE})`);
  console.log('After logging in, pick "Demo Corp" from the tenant dropdown top-left,');
  console.log('then "Demo Organization" on the Inventory Count Plans page.');
  console.log('=================================================');
}

main().catch((err) => {
  console.error('Demo seeding failed:', err.message);
  process.exit(1);
});
