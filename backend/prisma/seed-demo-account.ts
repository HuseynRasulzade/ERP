/**
 * Demo account seeder — builds a ready-to-explore demo tenant through the
 * public HTTP API (not Prisma), so it runs unchanged against a local server
 * or the deployed one (e.g. Render) and exercises the real business rules:
 * every document below is saved and posted by the same endpoints the UI
 * calls.
 *
 *   npm run demo:seed                                  # http://localhost:3000
 *   npm run demo:seed -- https://<api-host>            # deployed API
 *   DEMO_EMAIL=... DEMO_PASSWORD=... npm run demo:seed -- <url>
 *
 * Idempotent: the demo user/tenant/organization and master data are looked
 * up by email/code and only created when missing; sample documents are only
 * created the first time (when the demo organization has no sales orders).
 * Test cases that walk through this data: docs/DEMO_TEST_CASES.md.
 */

export const DEMO_ACCOUNT = {
  email: 'demo@ccs-erp.az',
  password: 'Demo1234!',
  displayName: 'Demo User',
  tenantCode: 'ccs-demo',
  tenantName: 'CCS Demo',
  orgCode: 'DEMO',
  orgName: 'CCS Demo MMC',
};

const UNITS = [
  { code: 'PCS', name: 'Ədəd', symbol: 'əd', unitType: 'QUANTITY' },
  { code: 'KG', name: 'Kiloqram', symbol: 'kg', unitType: 'WEIGHT' },
  { code: 'HR', name: 'Saat', symbol: 'saat', unitType: 'TIME' },
];

const DEPARTMENTS = [
  { code: 'SALES', name: 'Satış' },
  { code: 'PROCUREMENT', name: 'Satınalma' },
  { code: 'FINANCE', name: 'Maliyyə' },
];

const WAREHOUSES = [
  {
    code: 'WH-MAIN',
    name: 'Əsas anbar',
    warehouseType: 'STANDARD',
    address: 'Bakı, Nərimanov r-nu',
  },
  {
    code: 'WH-RETAIL',
    name: 'Mağaza anbarı',
    warehouseType: 'RETAIL',
    address: 'Bakı, Nizami küç. 10',
  },
];

const CATEGORIES = ['Elektronika', 'Ofis ləvazimatı', 'Xidmətlər'];

// price = SALE price (AZN, excl. VAT), cost = PURCHASE price, stock = opening qty in WH-MAIN
const PRODUCTS = [
  {
    code: 'LAPTOP-001',
    name: 'Noutbuk Lenovo ThinkPad E14',
    category: 'Elektronika',
    unit: 'PCS',
    productType: 'GOODS',
    price: 1450,
    cost: 1150,
    stock: 25,
  },
  {
    code: 'MONITOR-001',
    name: 'Monitor Dell 24"',
    category: 'Elektronika',
    unit: 'PCS',
    productType: 'GOODS',
    price: 380,
    cost: 290,
    stock: 40,
  },
  {
    code: 'MOUSE-001',
    name: 'Simsiz siçan Logitech M185',
    category: 'Elektronika',
    unit: 'PCS',
    productType: 'GOODS',
    price: 25,
    cost: 15,
    stock: 200,
  },
  {
    code: 'PAPER-A4',
    name: 'A4 kağız (500 vərəq)',
    category: 'Ofis ləvazimatı',
    unit: 'PCS',
    productType: 'GOODS',
    price: 9.5,
    cost: 6.8,
    stock: 500,
  },
  {
    code: 'COFFEE-001',
    name: 'Qəhvə dənələri',
    category: 'Ofis ləvazimatı',
    unit: 'KG',
    productType: 'GOODS',
    price: 32,
    cost: 22,
    stock: 60,
  },
  {
    code: 'SRV-INSTALL',
    name: 'Quraşdırma xidməti',
    category: 'Xidmətlər',
    unit: 'HR',
    productType: 'SERVICE',
    price: 40,
    cost: 0,
    stock: 0,
  },
];

const COUNTERPARTIES = [
  {
    counterpartyType: 'CUSTOMER',
    code: 'CUST-001',
    name: 'Azər Tikinti MMC',
    taxId: '1400000001',
    vatPayer: true,
    phone: '+994 12 555 01 01',
    email: 'info@azertikinti.az',
    paymentTerms: 30,
    creditLimit: 50000,
  },
  {
    counterpartyType: 'CUSTOMER',
    code: 'CUST-002',
    name: 'Xəzər Logistika ASC',
    taxId: '1400000002',
    vatPayer: true,
    phone: '+994 12 555 02 02',
    email: 'office@xezerlog.az',
    paymentTerms: 15,
    creditLimit: 20000,
  },
  {
    counterpartyType: 'CUSTOMER',
    code: 'CUST-003',
    name: 'Gəncə Ticarət',
    taxId: '1400000003',
    vatPayer: false,
    phone: '+994 22 555 03 03',
    paymentTerms: 0,
  },
  {
    counterpartyType: 'SUPPLIER',
    code: 'SUPP-001',
    name: 'Tech Distribution LLC',
    taxId: '1500000001',
    vatPayer: true,
    phone: '+994 12 555 11 11',
    email: 'sales@techdist.az',
    paymentTerms: 45,
  },
  {
    counterpartyType: 'SUPPLIER',
    code: 'SUPP-002',
    name: 'Ofis Təchizat MMC',
    taxId: '1500000002',
    vatPayer: true,
    phone: '+994 12 555 12 12',
    paymentTerms: 30,
  },
  {
    counterpartyType: 'BOTH',
    code: 'PART-001',
    name: 'Kaspi Partnyor MMC',
    taxId: '1600000001',
    vatPayer: true,
    phone: '+994 12 555 21 21',
    paymentTerms: 30,
  },
];

export interface DemoSeedSummary {
  email: string;
  password: string;
  tenantId: string;
  organizationId: string;
  createdDocuments: boolean;
}

type Log = (message: string) => void;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`${method} ${path} -> ${status}: ${JSON.stringify(body)}`);
  }
}

class DemoApi {
  token?: string;
  tenantId?: string;

  constructor(private readonly baseUrl: string) {}

  async call<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.tenantId) headers['X-Tenant-Id'] = this.tenantId;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, method, path, parsed);
    return parsed as T;
  }

  get<T = any>(path: string) {
    return this.call<T>('GET', path);
  }

  post<T = any>(path: string, body: unknown = {}) {
    return this.call<T>('POST', path, body);
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** List endpoints return either a bare array or a paged `{ items }`/`{ data }` envelope. */
function rows(result: any): any[] {
  if (Array.isArray(result)) return result;
  return result?.items ?? result?.data ?? result?.rows ?? [];
}

async function findOrCreate(
  api: DemoApi,
  listPath: string,
  match: (row: any) => boolean,
  create: () => Promise<any>,
) {
  const existing = rows(await api.get(listPath)).find(match);
  return existing ?? create();
}

function isoDate(daysAgo = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function postDocument(
  api: DemoApi,
  documentType: string,
  doc: { id: string; version: number },
) {
  return api.post(`/documents/${documentType}/${doc.id}/post`, {
    expectedVersion: doc.version,
  });
}

async function signIn(api: DemoApi, account: DemoAccount, log: Log) {
  try {
    const res = await api.post('/auth/login', {
      email: account.email,
      password: account.password,
    });
    api.token = res.accessToken;
    log(`Signed in as existing demo user ${account.email}`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const res = await api.post('/auth/register', {
      email: account.email,
      password: account.password,
      displayName: account.displayName,
    });
    api.token = res.accessToken;
    log(`Registered demo user ${account.email}`);
  }
}

export type DemoAccount = typeof DEMO_ACCOUNT;

export async function seedDemoAccount(
  baseUrl: string,
  options: { account?: Partial<DemoAccount>; log?: Log } = {},
): Promise<DemoSeedSummary> {
  const account: DemoAccount = { ...DEMO_ACCOUNT, ...options.account };
  const log = options.log ?? console.log;
  const api = new DemoApi(baseUrl.replace(/\/+$/, ''));
  await signIn(api, account, log);

  // --- Tenant (the demo user becomes its Tenant Administrator) ------------
  const memberships = await api.get('/users/me/tenants');
  let tenantId = memberships.find(
    (m: any) => m.tenantCode === account.tenantCode,
  )?.tenantId;
  if (!tenantId) {
    const tenant = await api.post('/tenants', {
      code: account.tenantCode,
      name: account.tenantName,
      baseCurrencyCode: 'AZN',
    });
    tenantId = tenant.id;
    log(`Created tenant ${account.tenantCode}`);
  }
  api.tenantId = tenantId;

  // Accounting/tax prerequisites for posting invoices (both idempotent).
  await api.post('/accounting/chart/adopt');
  await api.post('/tax/localization/seed');

  const currencies = rows(await api.get('/currencies'));
  const azn = currencies.find((c) => c.code === 'AZN');

  // --- Organization ---------------------------------------------------------
  const org = await findOrCreate(
    api,
    '/organizations',
    (o) => o.code === account.orgCode,
    () =>
      api.post('/organizations', {
        code: account.orgCode,
        name: account.orgName,
        fullLegalName: `"${account.orgName}" Məhdud Məsuliyyətli Cəmiyyət`,
        legalForm: 'MMC',
        taxId: '1300000001',
        countryCode: 'AZ',
        registeredAddress: 'Bakı şəhəri, Nəsimi rayonu, Demo küç. 1',
        phone: '+994 12 555 00 00',
        email: 'office@ccs-erp.az',
        baseCurrencyId: azn?.id,
      }),
  );
  const orgPath = `/organizations/${org.id}`;

  for (const dept of DEPARTMENTS) {
    await findOrCreate(
      api,
      `${orgPath}/departments`,
      (d) => d.code === dept.code,
      () => api.post(`${orgPath}/departments`, dept),
    );
  }

  const warehouses: Record<string, any> = {};
  for (const wh of WAREHOUSES) {
    warehouses[wh.code] = await findOrCreate(
      api,
      `${orgPath}/warehouses`,
      (w) => w.code === wh.code,
      () => api.post(`${orgPath}/warehouses`, wh),
    );
  }

  // --- Catalog ----------------------------------------------------------------
  const units: Record<string, any> = {};
  for (const unit of UNITS) {
    units[unit.code] = await findOrCreate(
      api,
      '/units-of-measure',
      (u) => u.code === unit.code,
      () => api.post('/units-of-measure', unit),
    );
  }

  const categories: Record<string, any> = {};
  for (const name of CATEGORIES) {
    categories[name] = await findOrCreate(
      api,
      `${orgPath}/product-categories`,
      (c) => c.name === name,
      () => api.post(`${orgPath}/product-categories`, { name }),
    );
  }

  const products: Record<string, any> = {};
  for (const p of PRODUCTS) {
    products[p.code] = await findOrCreate(
      api,
      `${orgPath}/products`,
      (row) => row.code === p.code,
      () =>
        api.post(`${orgPath}/products`, {
          code: p.code,
          name: p.name,
          productType: p.productType,
          baseUnitId: units[p.unit].id,
          categoryId: categories[p.category].id,
          sku: p.code,
        }),
    );
  }

  const counterparties: Record<string, any> = {};
  for (const cp of COUNTERPARTIES) {
    counterparties[cp.code] = await findOrCreate(
      api,
      `${orgPath}/counterparties`,
      (row) => row.code === cp.code,
      () =>
        api.post(`${orgPath}/counterparties`, {
          ...cp,
          residencyStatus: 'RESIDENT',
          countryCode: 'AZ',
          currencyId: azn?.id,
        }),
    );
  }

  // --- Price lists ----------------------------------------------------------
  const priceListSpecs = [
    {
      priceListType: 'SALE',
      code: 'RETAIL',
      name: 'Pərakəndə qiymətlər',
      field: 'price' as const,
    },
    {
      priceListType: 'PURCHASE',
      code: 'PURCHASE',
      name: 'Alış qiymətləri',
      field: 'cost' as const,
    },
  ];
  for (const spec of priceListSpecs) {
    const existing = rows(await api.get(`${orgPath}/price-lists`)).find(
      (pl) => pl.code === spec.code,
    );
    if (existing) continue;
    const priceList = await api.post(`${orgPath}/price-lists`, {
      priceListType: spec.priceListType,
      code: spec.code,
      name: spec.name,
      currencyId: azn.id,
      validFrom: `${new Date().getUTCFullYear()}-01-01`,
    });
    for (const p of PRODUCTS) {
      if (p[spec.field] <= 0) continue;
      await api.post(`${orgPath}/price-lists/${priceList.id}/prices`, {
        productId: products[p.code].id,
        unitId: units[p.unit].id,
        price: p[spec.field],
        minQuantity: 1,
      });
    }
  }
  log(
    'Master data ready (departments, warehouses, units, categories, products, counterparties, price lists)',
  );

  // --- Sample documents (first run only) --------------------------------------
  const existingOrders = rows(await api.get(`${orgPath}/sales-orders`));
  const createdDocuments = existingOrders.length === 0;
  if (createdDocuments) {
    await seedDocuments(api, orgPath, {
      warehouses,
      units,
      products,
      counterparties,
    });
    log(
      'Sample documents created (opening stock, sales orders/invoices, purchase order, transfer)',
    );
  } else {
    log('Sample documents already exist — skipped');
  }

  return {
    email: account.email,
    password: account.password,
    tenantId,
    organizationId: org.id,
    createdDocuments,
  };
}

async function seedDocuments(
  api: DemoApi,
  orgPath: string,
  refs: {
    warehouses: Record<string, any>;
    units: Record<string, any>;
    products: Record<string, any>;
    counterparties: Record<string, any>;
  },
) {
  const { warehouses, units, products, counterparties } = refs;
  const line = (
    code: string,
    quantity: number,
    extra: Record<string, unknown> = {},
  ) => {
    const spec = PRODUCTS.find((p) => p.code === code)!;
    return {
      productId: products[code].id,
      unitId: units[spec.unit].id,
      quantity,
      ...extra,
    };
  };
  const goods = PRODUCTS.filter((p) => p.stock > 0);

  // Opening stock: a posted SURPLUS adjustment into the main warehouse.
  const opening = await api.post(`${orgPath}/inventory-adjustments`, {
    warehouseId: warehouses['WH-MAIN'].id,
    adjustmentType: 'SURPLUS',
    reasonCode: 'OTHER',
    documentDate: isoDate(14),
    description: 'Açılış qalığı (demo)',
    lines: goods.map((p) => line(p.code, p.stock)),
  });
  await postDocument(api, 'INVENTORY_ADJUSTMENT', opening);

  // Move part of the stock to the retail warehouse.
  const transfer = await api.post(`${orgPath}/warehouse-transfers`, {
    sourceWarehouseId: warehouses['WH-MAIN'].id,
    destinationWarehouseId: warehouses['WH-RETAIL'].id,
    transferType: 'INSTANT',
    documentDate: isoDate(10),
    lines: [line('MOUSE-001', 50), line('PAPER-A4', 100)],
  });
  await postDocument(api, 'WAREHOUSE_TRANSFER', transfer);

  // Sales orders: one posted, one left as a draft to edit/post in the UI.
  const postedOrder = await api.post(`${orgPath}/sales-orders`, {
    counterpartyId: counterparties['CUST-001'].id,
    documentDate: isoDate(7),
    description: 'Ofis avadanlığı sifarişi',
    lines: [
      line('LAPTOP-001', 5, { taxRate: 18 }),
      line('MONITOR-001', 5, { taxRate: 18 }),
      line('SRV-INSTALL', 4, { taxRate: 18 }),
    ],
  });
  await postDocument(api, 'SALES_ORDER', postedOrder);

  await api.post(`${orgPath}/sales-orders`, {
    counterpartyId: counterparties['CUST-002'].id,
    documentDate: isoDate(1),
    description: 'Qaralama sifariş — UI-dan keçirin',
    lines: [
      line('MOUSE-001', 20, { taxRate: 18 }),
      line('PAPER-A4', 50, { taxRate: 18 }),
    ],
  });

  // Sales invoices: a posted one (creates journal entry + VAT register) and a draft.
  const postedInvoice = await api.post(`${orgPath}/sales-invoices`, {
    counterpartyId: counterparties['CUST-001'].id,
    documentDate: isoDate(5),
    description: 'Ofis avadanlığı — hesab-faktura',
    lines: [
      line('LAPTOP-001', 5, { taxRate: 18 }),
      line('MONITOR-001', 5, { taxRate: 18 }),
    ],
  });
  await postDocument(api, 'SALES_INVOICE', postedInvoice);

  await api.post(`${orgPath}/sales-invoices`, {
    counterpartyId: counterparties['CUST-003'].id,
    documentDate: isoDate(0),
    lines: [line('COFFEE-001', 3, { taxRate: 18 })],
  });

  // Purchase order draft to a supplier (procurement/approval flow starts here).
  await api.post(`${orgPath}/purchase-orders`, {
    counterpartyId: counterparties['SUPP-001'].id,
    documentDate: isoDate(2),
    warehouseId: warehouses['WH-MAIN'].id,
    description: 'Noutbuk ehtiyatının artırılması',
    lines: [
      line('LAPTOP-001', 10, { price: 1150, taxRate: 18 }),
      line('MOUSE-001', 100, { price: 15, taxRate: 18 }),
    ],
  });
}

if (require.main === module) {
  const baseUrl =
    process.argv[2] ?? process.env.DEMO_API_URL ?? 'http://localhost:3000';
  const account: Partial<DemoAccount> = {};
  if (process.env.DEMO_EMAIL) account.email = process.env.DEMO_EMAIL;
  if (process.env.DEMO_PASSWORD) account.password = process.env.DEMO_PASSWORD;
  seedDemoAccount(baseUrl, { account })
    .then((summary) => {
      console.log('\nDemo account ready:');
      console.log(`  API:      ${baseUrl}`);
      console.log(`  Email:    ${summary.email}`);
      console.log(`  Password: ${summary.password}`);
      console.log(`  Tenant:   ${summary.tenantId}`);
      console.log(`  Org:      ${summary.organizationId}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
