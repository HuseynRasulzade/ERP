# Demo account & test cases

A ready-made demo tenant for trying the ERP (https://ccs-erp.onrender.com)
and a set of manual test cases that walk through it. The automated
counterpart lives in `test/demo-account.e2e-spec.ts` (IDs `DEMO-01..16`).

## Demo account

| | |
|---|---|
| Email | `demo@ccs-erp.az` |
| Password | `Demo1234!` |
| Tenant | `ccs-demo` — CCS Demo (base currency AZN) |
| Organization | `DEMO` — CCS Demo MMC |
| Role | Tenant Administrator (every permission) |

The login page also has a **"Sign in with the demo account" / "Demo hesabı
ilə daxil ol"** button that signs in with these credentials. A user with a
single tenant is now auto-selected into it after login.

### Creating / refreshing it

The seeder talks to the public HTTP API, so it runs against any instance:

```bash
cd backend
npm run demo:seed                              # local API (http://localhost:3000)
npm run demo:seed -- https://<render-api-host> # deployed API
```

`DEMO_EMAIL` / `DEMO_PASSWORD` override the credentials. Re-running it is
safe: existing records are matched by code and reused, and sample documents
are only created when the demo organization has no sales orders yet.

### What it contains

| Area | Data |
|---|---|
| Departments | `SALES` Satış, `PROCUREMENT` Satınalma, `FINANCE` Maliyyə |
| Warehouses | `WH-MAIN` Əsas anbar (standard), `WH-RETAIL` Mağaza anbarı (retail) |
| Units | `PCS` ədəd, `KG` kiloqram, `HR` saat |
| Categories | Elektronika, Ofis ləvazimatı, Xidmətlər |
| Products | see table below |
| Counterparties | `CUST-001` Azər Tikinti MMC, `CUST-002` Xəzər Logistika ASC, `CUST-003` Gəncə Ticarət (non-VAT payer), `SUPP-001` Tech Distribution LLC, `SUPP-002` Ofis Təchizat MMC, `PART-001` Kaspi Partnyor MMC (customer & supplier) |
| Price lists | `RETAIL` (SALE), `PURCHASE` (PURCHASE), both in AZN |
| Accounting | AZ chart of accounts adopted, VAT localization seeded (18%) |

| Code | Product | Unit | Sale price | Purchase price | Stock WH-MAIN | Stock WH-RETAIL |
|---|---|---|---:|---:|---:|---:|
| LAPTOP-001 | Noutbuk Lenovo ThinkPad E14 | PCS | 1 450.00 | 1 150.00 | 25 | – |
| MONITOR-001 | Monitor Dell 24" | PCS | 380.00 | 290.00 | 40 | – |
| MOUSE-001 | Simsiz siçan Logitech M185 | PCS | 25.00 | 15.00 | 150 | 50 |
| PAPER-A4 | A4 kağız (500 vərəq) | PCS | 9.50 | 6.80 | 400 | 100 |
| COFFEE-001 | Qəhvə dənələri | KG | 32.00 | 22.00 | 60 | – |
| SRV-INSTALL | Quraşdırma xidməti (service) | HR | 40.00 | – | – | – |

Sample documents (dates are relative to the day the seeder ran):

| Document | State | Content | Totals (AZN) |
|---|---|---|---|
| Inventory adjustment (SURPLUS) | Posted | Opening stock into WH-MAIN | – |
| Warehouse transfer (INSTANT) | Posted | 50 × MOUSE-001, 100 × PAPER-A4 → WH-RETAIL | – |
| SO-…-000001 → CUST-001 | Posted | 5 laptops, 5 monitors, 4 h installation | 9 310.00 + 1 675.80 VAT = **10 985.80** |
| SO-…-000002 → CUST-002 | Draft | 20 mice, 50 × A4 paper | 975.00 + 175.50 = **1 150.50** |
| SI-…-000001 → CUST-001 | Posted | 5 laptops, 5 monitors | 9 150.00 + 1 647.00 = **10 797.00** |
| SI-…-000002 → CUST-003 | Draft | 3 kg coffee | 96.00 + 17.28 = **113.28** |
| Purchase order → SUPP-001 | Draft | 10 laptops @ 1 150, 100 mice @ 15 | 13 000.00 + 2 340.00 = **15 340.00** |

### Role accounts (for permission tests)

`npm run prisma:seed` additionally creates tenant `acme` / organization
`sinteks` with one user per role, all with password `Passw0rd!23`:
`procurement_officer@acme.test`, `department_head@acme.test`,
`director@acme.test`, `finance_user@acme.test`, `accounting_user@acme.test`,
`warehouse_user@acme.test`, `warehouse_supervisor@acme.test`,
`sales_manager@acme.test`, `auditor@acme.test`. Use them for the RBAC cases
(TC-RB-*) below.

---

## Manual test cases

Format: **ID — title** · *Preconditions* · Steps · **Expected result**.
Unless stated otherwise, start logged in as the demo account with
organization `DEMO — CCS Demo MMC` selected. Record each run as
Pass / Fail / Blocked with the date, browser and a note.

### 1. Authentication & session

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-AU-01 | Login with demo button | Open `/login`, click **Sign in with the demo account** | Redirected to **Sales Orders**; tenant selector shows *CCS Demo (ccs-demo)*; header shows *Demo User* |
| TC-AU-02 | Login with typed credentials | Log out, type `demo@ccs-erp.az` / `Demo1234!`, click **Sign in** | Same as TC-AU-01 |
| TC-AU-03 | Wrong password | Type `demo@ccs-erp.az` / `wrong` | Error toast, stays on `/login`, no session created |
| TC-AU-04 | Empty fields | Click **Sign in** with empty email | Browser "required" validation, no request sent |
| TC-AU-05 | Logout | Click **Log out** | Back on `/login`; browser *Back* does not reveal data; opening `/sales-orders` redirects to login |
| TC-AU-06 | Session persists on reload | After login press F5 | Still logged in, same tenant and organization |
| TC-AU-07 | Language switch | Click **AZ**, then **EN** | All labels switch language; data (names, numbers) unchanged; choice survives reload |
| TC-AU-08 | Login throttling | Submit a wrong password 11 times within a minute | Requests after the 10th are rejected with "too many requests" |
| TC-AU-09 | Register new user | `/register` with a new email | New user is logged in with no tenant and is offered **+ New tenant**; cannot see `ccs-demo` |

### 2. Organization & master data

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-MD-01 | Organization card | **Organizations** → `DEMO` | Legal name, VÖEN `1300000001`, address, AZN base currency shown |
| TC-MD-02 | Departments & warehouses | Open the organization's departments and warehouses tabs | 3 departments (SALES, PROCUREMENT, FINANCE); 2 warehouses (WH-MAIN standard, WH-RETAIL retail) |
| TC-MD-03 | Product catalog | **Product Catalog** | 6 products in 3 categories; `SRV-INSTALL` is a *Service* |
| TC-MD-04 | Create product | **+ New**, code `TEST-001`, unit `PCS`, category *Elektronika*, save | Product appears in the list; duplicate code `TEST-001` a second time is rejected |
| TC-MD-05 | Price lists | **Price Lists** → `RETAIL` | 6 prices; LAPTOP-001 = 1 450.00 AZN. `PURCHASE` has 5 prices (no service) |
| TC-MD-06 | Counterparty list & filter | **Counterparties**, filter by type *Customer* | 3 customers + `PART-001` (Both) depending on filter semantics; suppliers hidden |
| TC-MD-07 | VÖEN validation | Create a counterparty with VÖEN `12345` | Rejected: "VÖEN must be exactly 10 digits" |
| TC-MD-08 | Phone validation | Create a counterparty with phone `abc` | Rejected: invalid phone format |
| TC-MD-09 | Excel export | On Counterparties / Products click **Export to Excel** | CSV downloads, opens in Excel with Azerbaijani characters (ə, ş, ç) intact |

### 3. Sales

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-SA-01 | Sales order list | **Sales Orders** | 2 orders: SO-…-000001 *Posted* 10 985.80, SO-…-000002 *Not posted* 1 150.50 |
| TC-SA-02 | Price auto-fill | **+ New order**, customer `CUST-002`, add 2 × MONITOR-001 without a price, VAT 18% | Price 380.00 taken from `RETAIL`; subtotal 760.00, VAT 136.80, total 896.80 |
| TC-SA-03 | Explicit price override | New order line 1 × LAPTOP-001, price 1 300 | Line keeps 1 300.00 (price list ignored) |
| TC-SA-04 | Supplier not allowed | New order with counterparty `SUPP-001` | Rejected with a validation error (sales need a customer) |
| TC-SA-05 | Zero quantity | Line quantity 0 | Rejected; nothing saved |
| TC-SA-06 | Post draft order | Open SO-…-000002 → **Post** | Status *Posted*; editing fields is now blocked |
| TC-SA-07 | Unpost / edit / re-post | On a posted order **Unpost**, change quantity, save, **Post** | Edit allowed only while unposted; totals recalculated; re-post succeeds |
| TC-SA-08 | Concurrent edit | Open the same draft order in two tabs, save in tab 1, then save in tab 2 | Tab 2 gets a *concurrency conflict* error; tab 1's change is kept |
| TC-SA-09 | Invoice from order | On SO-…-000001 use *Create based on → Sales invoice* | New draft invoice pre-filled with the order's customer and lines |
| TC-SA-10 | Posted invoice | **Sales Invoices** → SI-…-000001 | Posted, total 10 797.00 (9 150.00 + 1 647.00 VAT) |
| TC-SA-11 | Post draft invoice | Open SI-…-000002 (CUST-003, coffee) → **Post** | Posted; total 113.28; a journal entry and VAT register record are created (see TC-AC-02) |
| TC-SA-12 | Cancel a document | Create a new draft order → **Cancel** | Status *Cancelled*; cannot be posted |
| TC-SA-13 | Print form | Open SI-…-000001 → **Print** | Printable invoice with organization requisites, customer, lines and totals |

### 4. Procurement

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-PR-01 | Draft purchase order | **Purchase Orders** | 1 draft PO to *Tech Distribution LLC*, total 15 340.00 |
| TC-PR-02 | Submit for approval | Open the PO → submit for approval | Approval status *Pending*; appears in **Approvals Inbox** |
| TC-PR-03 | Approve / reject | From **Approvals Inbox** approve (or reject with a comment) | Status changes to *Approved* / *Rejected*; decision visible in audit log |
| TC-PR-04 | Goods receipt from PO | On the approved PO *Create based on → Goods receipt* into WH-MAIN, post | LAPTOP-001 stock in WH-MAIN rises from 25 to 35; MOUSE-001 from 150 to 250 |
| TC-PR-05 | Purchase invoice | Create a purchase invoice for the receipt, post | Supplier payable and input VAT recorded |
| TC-PR-06 | Purchase requirement | **Purchase Requirements** → new, 5 × MONITOR-001 | Saved as draft; can be turned into a PO for a supplier |

### 5. Warehouse

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-WH-01 | Stock balance report | **Inventory Reports** → stock balance | Quantities match the product table above (e.g. MOUSE-001: 150 WH-MAIN, 50 WH-RETAIL) |
| TC-WH-02 | Instant transfer | **Warehouse Transfers** → new INSTANT, 10 × LAPTOP-001 WH-MAIN → WH-RETAIL, post | LAPTOP-001: WH-MAIN 25 → 15, WH-RETAIL 0 → 10 |
| TC-WH-03 | Transfer more than available | Transfer 1 000 × MONITOR-001 | Posting fails with an insufficient-stock error; balances unchanged |
| TC-WH-04 | Write-off | **Inventory Adjustments** → WRITE_OFF, reason DAMAGE, 2 × MOUSE-001, post | WH-MAIN MOUSE-001 decreases by 2 |
| TC-WH-05 | Internal consumption | **Internal Consumption** → 5 × PAPER-A4 from WH-MAIN, post | PAPER-A4 decreases by 5 |
| TC-WH-06 | Stock card | Inventory Reports → stock card for MOUSE-001 / WH-MAIN | Shows opening surplus +200, transfer −50, and any later movements in date order |
| TC-WH-07 | Inventory count | **Inventory Count** → plan for WH-RETAIL, enter counted 48 × MOUSE-001 | Variance −2 shown; completing the count creates the adjustment |

### 6. Accounting & tax

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-AC-01 | Chart of accounts | **Chart of Accounts** | AZ national chart loaded (e.g. 211 receivables, 521 VAT, 601 revenue) |
| TC-AC-02 | Journal entry of invoice | Open SI-…-000001 → journal entries / movements | One balanced entry: Debit receivables 10 797.00 = Credit revenue 9 150.00 + VAT 1 647.00 |
| TC-AC-03 | Trial balance | **Trial Balance** for the current month | Total debit = total credit; receivables account shows 10 797.00 |
| TC-AC-04 | Tax register | **Tax Engine** → VAT register | Output VAT 1 647.00 for SI-…-000001 |
| TC-AC-05 | Unpost reverses accounting | Unpost SI-…-000001, check trial balance, post again | Entry disappears after unpost and is re-created after post; trial balance stays balanced |
| TC-AC-06 | Manual operation | **Manual Operations** → new entry with unequal debit/credit | Rejected as unbalanced; balanced entry posts |
| TC-AC-07 | Closed period | **Periods** → close the current month, then try to post a draft dated in it | Posting rejected (closed period); reopen restores posting |

### 7. Roles, security & audit

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-RB-01 | Tenant isolation | Log in as a freshly registered user; open `/sales-orders` | `ccs-demo` is not in the tenant list; no demo data visible anywhere |
| TC-RB-02 | Sales manager | Log in as `sales_manager@acme.test` | Sales menu works; procurement/accounting create actions hidden or rejected |
| TC-RB-03 | Warehouse user | Log in as `warehouse_user@acme.test` | Can view inventory/receipts; cannot approve purchase orders |
| TC-RB-04 | Auditor read-only | Log in as `auditor@acme.test` | Can view documents and audit log; every create/post action is hidden or rejected |
| TC-RB-05 | Approval chain | `procurement_officer` creates a PO → `department_head` approves → `director`/`finance_user` approves | PO moves through each step; each approver sees it in **Approvals Inbox** only at their step |
| TC-RB-06 | Audit log | As demo user open **Audit Log** after TC-SA-06 | Entries for create/post with user, timestamp and document reference |
| TC-RB-07 | Roles page | **Roles & Permissions** | Tenant Administrator lists all permissions; custom role can be created and assigned |

### 8. Non-functional

| ID | Title | Steps | Expected result |
|---|---|---|---|
| TC-NF-01 | Cold start | Open the site after ~15 min idle (Render free tier) | First request may take up to ~1 min; app then loads normally without errors |
| TC-NF-02 | Mobile width | Open on a phone / 375 px viewport | Login and lists usable; no horizontal page scroll on the login page |
| TC-NF-03 | Browsers | Repeat TC-AU-01 and TC-SA-02 in Chrome, Firefox, Safari | Same behaviour |
| TC-NF-04 | Deep link | While logged in, paste `/sales-invoices/<id>` in a new tab | Opens the invoice directly |

---

## Automated tests

```bash
cd backend
npm run test:e2e -- demo-account
```

Runs the seeder against a real listening instance of the API and checks
`DEMO-01..16`: account/tenant creation, permissions, tenant isolation,
master-data counts, posted vs draft documents, invoice totals and journal
balance, warehouse stock after opening balance + transfer, posting the draft
order, and that a second seeder run creates no duplicates.
