/**
 * Phase 13 — AR/AP Counterparty Settlement Engine.
 *
 * Same direct-service testing style as test/phase11.e2e-spec.ts — real
 * Postgres, hand-rolled fixtures, open items created directly via
 * `OpenItemService` (bypassing a full SalesInvoice posting chain) so the
 * ALLOCATION engine itself — the actual Phase 13 value — is exercised
 * directly, covering the spec's own worked examples (sections 149-165).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OpenItemService } from '../src/settlement/open-item.service';
import { PaymentAllocationService } from '../src/settlement/payment-allocation.service';
import { AdvanceService } from '../src/settlement/advance.service';
import { AgeingService } from '../src/settlement/ageing.service';

describe('Phase 13 — Settlement Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let openItems: OpenItemService;
  let allocations: PaymentAllocationService;
  let advances: AdvanceService;
  let ageing: AgeingService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let customerId: string;

  const newInvoice = async (amount: string, dueDate: Date) =>
    prisma.runInTransaction((tx) =>
      openItems.createReceivable(tenantId, { organizationId, counterpartyId: customerId, sourceDocumentType: 'SALES_INVOICE', sourceDocumentId: randomUUID(), currencyId, amount: new Decimal(amount), baseCurrencyAmount: new Decimal(amount), dueDate, effectiveDate: new Date('2026-01-01') }, tx),
    );

  const newPayment = async (amount: string) => {
    const id = randomUUID();
    await prisma.settlementPayment.create({ data: { id, tenantId, organizationId, direction: 'INCOMING', counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, amount, documentDate: new Date('2026-01-10'), postingStatus: 'POSTED', postedAt: new Date() } });
    return id;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    openItems = app.get(OpenItemService);
    allocations = app.get(PaymentAllocationService);
    advances = app.get(AdvanceService);
    ageing = app.get(AgeingService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p13-${run}`, name: 'Phase 13 tenant' } });
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A13${String(run).slice(-6)}`, name: 'Phase 13 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG13-${run}`, name: 'Phase 13 org', baseCurrencyId: currencyId } });
    customerId = randomUUID();
    await prisma.counterparty.create({ data: { id: customerId, tenantId, organizationId, counterpartyType: 'CUSTOMER', code: `CUST13-${run}`, name: 'Phase 13 customer' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('TEST 149 — basic receivable + full payment settles it', async () => {
    const invoice = await newInvoice('1000', new Date('2026-02-01'));
    expect(invoice.status).toBe('OPEN');

    const paymentId = await newPayment('1000');
    const [alloc] = await allocations.allocateManual(tenantId, organizationId, 'system', { paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: paymentId, counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, allocationDate: '2026-02-01', lines: [{ openItemType: 'SETTLEMENT_OBLIGATION', openItemId: invoice.id, amount: 1000 }] });
    expect(alloc.settlementAmount.toString()).toBe('1000');

    const updated = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(new Decimal(updated.remainingAmount!.toString()).toString()).toBe('0');
    expect(updated.status).toBe('SETTLED');
  });

  it('TEST 150/151 — partial then multiple payments', async () => {
    const invoice = await newInvoice('1000', new Date('2026-02-01'));
    const p1 = await newPayment('300');
    await allocations.allocateManual(tenantId, organizationId, 'system', { paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: p1, counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, allocationDate: '2026-01-15', lines: [{ openItemType: 'SETTLEMENT_OBLIGATION', openItemId: invoice.id, amount: 300 }] });

    let updated = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(new Decimal(updated.remainingAmount!.toString()).toString()).toBe('700');
    expect(updated.status).toBe('PARTIALLY_SETTLED');

    const p2 = await newPayment('200');
    await allocations.allocateManual(tenantId, organizationId, 'system', { paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: p2, counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, allocationDate: '2026-01-20', lines: [{ openItemType: 'SETTLEMENT_OBLIGATION', openItemId: invoice.id, amount: 200 }] });

    updated = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(new Decimal(updated.remainingAmount!.toString()).toString()).toBe('500');

    const allocationCount = await prisma.settlementAllocation.count({ where: { tenantId, sourceOpenItemId: invoice.id, status: 'ACTIVE' } });
    expect(allocationCount).toBe(2);
  });

  it('TEST 152 — one payment auto-allocated FIFO across multiple invoices', async () => {
    const a = await newInvoice('500', new Date('2026-01-01'));
    const b = await newInvoice('700', new Date('2026-01-05'));
    const paymentId = await newPayment('1000');

    await allocations.allocateAutomatic(tenantId, organizationId, 'system', { paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: paymentId, counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, allocationDate: '2026-01-10', amount: 1000 });

    const updatedA = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: a.id } });
    const updatedB = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: b.id } });
    expect(updatedA.status).toBe('SETTLED');
    expect(new Decimal(updatedB.remainingAmount!.toString()).toString()).toBe('200');
  });

  it('TEST 153 — customer advance created and applied', async () => {
    const paymentId = await newPayment('1000');
    const advance = await advances.createFromUnallocatedPayment(tenantId, organizationId, 'system', paymentId);
    expect(new Decimal(advance.remainingAmount.toString()).toString()).toBe('1000');

    const invoice = await newInvoice('1500', new Date('2026-03-01'));
    await advances.apply(tenantId, organizationId, 'system', advance.id, 'SETTLEMENT_OBLIGATION', invoice.id, 1000);

    const updatedInvoice = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(new Decimal(updatedInvoice.remainingAmount!.toString()).toString()).toBe('500');
    const updatedAdvance = await prisma.settlementAdvance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(new Decimal(updatedAdvance.remainingAmount.toString()).toString()).toBe('0');
    expect(updatedAdvance.status).toBe('FULLY_APPLIED');
  });

  it('TEST 155 — overpayment leaves an unallocated remainder convertible to advance', async () => {
    const invoice = await newInvoice('1000', new Date('2026-04-01'));
    const paymentId = await newPayment('1200');
    await allocations.allocateManual(tenantId, organizationId, 'system', { paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: paymentId, counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, allocationDate: '2026-04-05', lines: [{ openItemType: 'SETTLEMENT_OBLIGATION', openItemId: invoice.id, amount: 1000 }] });

    const advance = await advances.createFromUnallocatedPayment(tenantId, organizationId, 'system', paymentId);
    expect(new Decimal(advance.originalAmount.toString()).toString()).toBe('200');
  });

  it('TEST 163 — FX gain on full payment at a different rate', async () => {
    const invoiceUsd = await prisma.runInTransaction((tx) =>
      openItems.createReceivable(tenantId, { organizationId, counterpartyId: customerId, sourceDocumentType: 'SALES_INVOICE', sourceDocumentId: randomUUID(), currencyId, amount: new Decimal('1000'), baseCurrencyAmount: new Decimal('1700'), exchangeRate: new Decimal('1.70'), dueDate: new Date('2026-05-01'), effectiveDate: new Date('2026-04-01') }, tx),
    );
    const paymentId = randomUUID();
    await prisma.settlementPayment.create({ data: { id: paymentId, tenantId, organizationId, direction: 'INCOMING', counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, amount: '1000', exchangeRate: '1.75', documentDate: new Date('2026-04-10'), postingStatus: 'POSTED', postedAt: new Date() } });

    const [alloc] = await allocations.allocateManual(tenantId, organizationId, 'system', { paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: paymentId, counterpartyId: customerId, counterpartyRole: 'CUSTOMER', currencyId, exchangeRate: 1.75, allocationDate: '2026-04-10', lines: [{ openItemType: 'SETTLEMENT_OBLIGATION', openItemId: invoiceUsd.id, amount: 1000 }] });

    expect(alloc.realizedFxAmount.toString()).toBe('50'); // 1000 * (1.75 - 1.70)
    const updated = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: invoiceUsd.id } });
    expect(new Decimal(updated.remainingAmount!.toString()).toString()).toBe('0');
  });

  it('TEST 160 — ageing bucket for an overdue open item', async () => {
    const invoice = await newInvoice('1000', new Date('2026-01-01'));
    const rows = await ageing.customerAgeing(tenantId, organizationId, new Date('2026-02-15'));
    const row = rows.find((r) => r.openItemId === invoice.id)!;
    expect(row.daysOverdue).toBe(45);
    expect(row.bucket).toBe('31_60');
  });

  it('TEST 158 — offset nets receivable against payable for the same counterparty', async () => {
    const invoice = await newInvoice('10000', new Date('2026-06-01'));
    const payable = await prisma.runInTransaction((tx) =>
      openItems.createPayable(tenantId, { organizationId, counterpartyId: customerId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: randomUUID(), currencyId, amount: new Decimal('7000'), baseCurrencyAmount: new Decimal('7000'), dueDate: new Date('2026-06-01'), effectiveDate: new Date('2026-06-01') }, tx),
    );

    // Mirrors exactly what SettlementOffsetPostingHandler does on POST for
    // each line — applying 7,000 to both sides nets them.
    await prisma.runInTransaction(async (tx) => {
      await openItems.applyToOpenItem(tenantId, 'SETTLEMENT_OBLIGATION', invoice.id, new Decimal('7000'), tx);
      await openItems.applyToOpenItem(tenantId, 'SUPPLIER_PAYABLE', payable.id, new Decimal('7000'), tx);
    });

    const updatedInvoice = await prisma.settlementObligation.findUniqueOrThrow({ where: { id: invoice.id } });
    const updatedPayable = await prisma.supplierPayable.findUniqueOrThrow({ where: { id: payable.id } });
    expect(new Decimal(updatedInvoice.remainingAmount!.toString()).toString()).toBe('3000');
    expect(new Decimal(updatedPayable.remainingAmount!.toString()).toString()).toBe('0');
    expect(updatedPayable.status).toBe('SETTLED');
  });
});
