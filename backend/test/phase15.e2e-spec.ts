/**
 * Phase 15 — Cash / Kassa Engine.
 *
 * Same direct-service testing style as test/phase14.e2e-spec.ts. Covers:
 * a cash receipt posting into the cash register (SettlementPayment with
 * cashDeskId set), a cash desk transfer (INSTANT), a physical count
 * detecting a shortage, a CashCountAdjustment resolving it, and the
 * CashDailyClose gate sequence (blocked -> count required -> closed).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettlementPaymentService } from '../src/settlement/settlement-payment.service';
import { DocumentPostingService } from '../src/document-framework/document-posting.service';
import { SETTLEMENT_PAYMENT_TYPE } from '../src/settlement/settlement-payment.repository';
import { CashMovementService } from '../src/cash/cash-movement.service';
import { CashDeskTransferService } from '../src/cash/cash-desk-transfer.service';
import { CASH_DESK_TRANSFER_TYPE } from '../src/cash/cash-desk-transfer.repository';
import { CashPhysicalCountService } from '../src/cash/cash-physical-count.service';
import { CashCountAdjustmentService } from '../src/cash/cash-count-adjustment.service';
import { CASH_COUNT_ADJUSTMENT_TYPE } from '../src/cash/cash-count-adjustment.repository';
import { CashDailyCloseService } from '../src/cash/cash-daily-close.service';
import { CashierAssignmentService } from '../src/cash/cashier-assignment.service';

describe('Phase 15 — Cash Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payments: SettlementPaymentService;
  let posting: DocumentPostingService;
  let cashMovements: CashMovementService;
  let transfers: CashDeskTransferService;
  let physicalCounts: CashPhysicalCountService;
  let countAdjustments: CashCountAdjustmentService;
  let dailyClose: CashDailyCloseService;
  let cashierAssignments: CashierAssignmentService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let membershipId: string;
  let userId: string;
  let deskAId: string;
  let deskBId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    payments = app.get(SettlementPaymentService);
    posting = app.get(DocumentPostingService);
    cashMovements = app.get(CashMovementService);
    transfers = app.get(CashDeskTransferService);
    physicalCounts = app.get(CashPhysicalCountService);
    countAdjustments = app.get(CashCountAdjustmentService);
    dailyClose = app.get(CashDailyCloseService);
    cashierAssignments = app.get(CashierAssignmentService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p15-${run}`, name: 'Phase 15 tenant' } });
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A15${String(run).slice(-6)}`, name: 'Phase 15 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG15-${run}`, name: 'Phase 15 org', baseCurrencyId: currencyId } });

    deskAId = randomUUID();
    await prisma.cashbox.create({ data: { id: deskAId, tenantId, organizationId, code: `CASH-A-${run}`, name: 'Main cash desk', currencyId, requireDenominationCount: false } });
    deskBId = randomUUID();
    await prisma.cashbox.create({ data: { id: deskBId, tenantId, organizationId, code: `CASH-B-${run}`, name: 'Branch cash desk', currencyId, requireDenominationCount: true } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p15-${run}@e2e.test`, passwordHash: 'x', displayName: 'P15 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a cash receipt (SettlementPayment.cashDeskId) posts into the cash register', async () => {
    const receipt = await payments.create(tenantId, membershipId, organizationId, userId, { direction: 'INCOMING', currencyId, amount: 1000, cashDeskId: deskAId, operationType: 'OTHER_INCOME', documentDate: '2026-03-01' });
    await posting.post(tenantId, SETTLEMENT_PAYMENT_TYPE, receipt.id, 1, userId);
    const balance = await cashMovements.getBalance(tenantId, deskAId, currencyId);
    expect(balance.toString()).toBe('1000');
  });

  it('an INSTANT cash desk transfer moves the balance between two desks atomically', async () => {
    const transfer = await transfers.create(tenantId, membershipId, organizationId, userId, { sourceCashDeskId: deskAId, destinationCashDeskId: deskBId, currencyId, amount: 400, transferMode: 'INSTANT', documentDate: '2026-03-02' });
    await posting.post(tenantId, CASH_DESK_TRANSFER_TYPE, transfer.id, 1, userId);
    const [balanceA, balanceB] = await Promise.all([cashMovements.getBalance(tenantId, deskAId, currencyId), cashMovements.getBalance(tenantId, deskBId, currencyId)]);
    expect(balanceA.toString()).toBe('600');
    expect(balanceB.toString()).toBe('400');
  });

  it('a physical count detects a shortage, and a posted CashCountAdjustment resolves it', async () => {
    const count = await physicalCounts.count(tenantId, membershipId, organizationId, userId, { cashDeskId: deskAId, currencyId, manualTotal: 550 });
    expect(new Decimal((count as any).difference.toString()).toString()).toBe('-50');

    const adjustment = await countAdjustments.create(tenantId, membershipId, organizationId, userId, { cashDeskId: deskAId, physicalCountId: (count as any).id, adjustmentType: 'CASH_SHORTAGE', reasonCode: 'COUNT_SHORTAGE', currencyId, amount: 50, documentDate: '2026-03-03' });
    await posting.post(tenantId, CASH_COUNT_ADJUSTMENT_TYPE, adjustment.id, 1, userId);

    const balance = await cashMovements.getBalance(tenantId, deskAId, currencyId);
    expect(balance.toString()).toBe('550');
  });

  it('CashDailyClose is COUNT_REQUIRED for a desk that mandates a denomination count until one exists, then CLOSED', async () => {
    await cashierAssignments.assign(tenantId, membershipId, organizationId, userId, { cashDeskId: deskBId, assignedUserId: userId, validFrom: '2026-03-01' });
    const receipt = await payments.create(tenantId, membershipId, organizationId, userId, { direction: 'INCOMING', currencyId, amount: 400, cashDeskId: deskBId, cashierId: userId, operationType: 'OTHER_INCOME', documentDate: '2026-03-04' });
    await posting.post(tenantId, SETTLEMENT_PAYMENT_TYPE, receipt.id, 1, userId);

    const attempt1 = await dailyClose.attempt(tenantId, membershipId, organizationId, userId, { cashDeskId: deskBId, currencyId, businessDate: '2026-03-04' });
    expect(attempt1.status).toBe('COUNT_REQUIRED');

    await physicalCounts.count(tenantId, membershipId, organizationId, userId, { cashDeskId: deskBId, currencyId, manualTotal: 400 });

    const attempt2 = await dailyClose.attempt(tenantId, membershipId, organizationId, userId, { cashDeskId: deskBId, currencyId, businessDate: '2026-03-04' });
    expect(attempt2.status).toBe('CLOSED');
    expect((attempt2 as any).closingBookBalance.toString()).toBe('400');
  });
});
