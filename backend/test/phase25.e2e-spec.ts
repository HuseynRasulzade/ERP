/**
 * Phase 25 — Audit / Change History / Traceability / Evidence Platform.
 *
 * Direct-service testing style matching phases 15-24's own test files.
 * Exercises the hash-chained AuditEvent extension, field-diff engine
 * (with stable-id collection diffing), document posting trace, GL
 * lineage (over a real posted journal entry), investigation timeline
 * reconstruction, legal-hold-blocks-retention, integrity verification
 * (including tamper detection), and export packaging.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AccountingPostingEngine } from '../src/accounting-core/accounting-posting-engine.service';
import { AuditDiffService } from '../src/audit-trail/audit-diff.service';
import { DocumentAuditService } from '../src/audit-trail/document-audit.service';
import { AuditLineageService } from '../src/audit-trail/audit-lineage.service';
import { AuditInvestigationService } from '../src/audit-trail/audit-investigation.service';
import { AuditLegalHoldService } from '../src/audit-trail/audit-legal-hold.service';
import { AuditRetentionService } from '../src/audit-trail/audit-retention.service';
import { AuditIntegrityService } from '../src/audit-trail/audit-integrity.service';
import { AuditExportService } from '../src/audit-trail/audit-export.service';

describe('Phase 25 — Audit Trail Platform (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  let posting: AccountingPostingEngine;
  let diff: AuditDiffService;
  let documentAudit: DocumentAuditService;
  let lineage: AuditLineageService;
  let investigations: AuditInvestigationService;
  let legalHold: AuditLegalHoldService;
  let retention: AuditRetentionService;
  let integrity: AuditIntegrityService;
  let exportService: AuditExportService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let userId: string;
  let cashAccountId: string;
  let equityAccountId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
    posting = app.get(AccountingPostingEngine);
    diff = app.get(AuditDiffService);
    documentAudit = app.get(DocumentAuditService);
    lineage = app.get(AuditLineageService);
    investigations = app.get(AuditInvestigationService);
    legalHold = app.get(AuditLegalHoldService);
    retention = app.get(AuditRetentionService);
    integrity = app.get(AuditIntegrityService);
    exportService = app.get(AuditExportService);

    tenantId = randomUUID();
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A25${String(run).slice(-6)}`, name: 'Phase 25 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.create({ data: { id: tenantId, code: `p25-${run}`, name: 'Phase 25 tenant', baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG25-${run}`, name: 'Phase 25 org', baseCurrencyId: currencyId } });
    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p25-${run}@e2e.test`, passwordHash: 'x', displayName: 'P25 User' } });

    const coa = await prisma.chartOfAccounts.create({ data: { tenantId, code: `COA25-${run}`, name: 'Phase 25 chart' } });
    cashAccountId = randomUUID();
    await prisma.account.create({ data: { id: cashAccountId, tenantId, chartOfAccountsId: coa.id, code: `101-${run}`, name: 'Cash', accountClass: 'ASSET', normalBalance: 'DEBIT' } });
    equityAccountId = randomUUID();
    await prisma.account.create({ data: { id: equityAccountId, tenantId, chartOfAccountsId: coa.id, code: `301-${run}`, name: 'Capital', accountClass: 'EQUITY', normalBalance: 'CREDIT' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('chains each new audit event to the tenant\'s previous event hash', async () => {
    const first = await audit.record({ tenantId, eventType: 'TEST_EVENT_1', entityType: 'TestEntity', entityId: 'e1', action: 'CREATE', userId });
    const second = await audit.record({ tenantId, eventType: 'TEST_EVENT_2', entityType: 'TestEntity', entityId: 'e1', action: 'UPDATE', userId });
    expect(first.integrityHash).toBeTruthy();
    expect(second.previousEventHash).toBe(first.integrityHash);
  });

  it('diffs multi-field and collection changes using stable line ids, not array position', () => {
    const before = { name: 'Old Name', paymentTerms: 30, lines: [{ id: 'L1', qty: 10 }, { id: 'L2', qty: 5 }] };
    const after = { name: 'New Name', paymentTerms: 60, lines: [{ id: 'L1', qty: 10 }, { id: 'L3', qty: 7 }] };
    const changes = diff.diff(before, after);
    expect(changes.find((c) => c.fieldPath === 'name')).toBeDefined();
    expect(changes.find((c) => c.fieldPath === 'paymentTerms')).toBeDefined();
    expect(changes.find((c) => c.fieldPath === 'lines[line_id=L2]')?.changeType).toBe('ITEM_REMOVED');
    expect(changes.find((c) => c.fieldPath === 'lines[line_id=L3]')?.changeType).toBe('ITEM_ADDED');
    expect(changes.find((c) => c.fieldPath === 'lines[line_id=L1]')).toBeUndefined(); // unchanged line produces no diff
  });

  it('surfaces a document\'s POST/UNPOST/REPOST timeline and GL lineage from a real posted journal entry', async () => {
    const documentId = randomUUID();
    await audit.record({ tenantId, eventType: 'DOC_POSTED_V1', eventCategory: 'POSTING', operation: 'POST', entityType: 'TestDocument', entityId: documentId, documentType: 'TEST_DOCUMENT', documentId, action: 'POST', userId, entityVersionAfter: 1 });
    await audit.record({ tenantId, eventType: 'DOC_UNPOSTED', eventCategory: 'POSTING', operation: 'UNPOST', entityType: 'TestDocument', entityId: documentId, documentType: 'TEST_DOCUMENT', documentId, action: 'UNPOST', userId, entityVersionBefore: 1, entityVersionAfter: 1, reason: 'Correction needed' });
    await audit.record({ tenantId, eventType: 'DOC_POSTED_V2', eventCategory: 'POSTING', operation: 'POST', entityType: 'TestDocument', entityId: documentId, documentType: 'TEST_DOCUMENT', documentId, action: 'POST', userId, entityVersionAfter: 2 });

    const trace = await documentAudit.postingTrace(tenantId, 'TEST_DOCUMENT', documentId);
    expect(trace.map((t) => t.operation)).toEqual(['POST', 'UNPOST', 'POST']);
    expect(trace[2].entityVersionAfter).toBe(2);

    // A real posted journal entry sourced from this document, for lineage.
    await posting.postBatch(tenantId, userId, {
      organizationId,
      businessDate: new Date('2026-03-01'),
      description: 'Test lineage batch',
      sourceDocumentType: 'TEST_DOCUMENT',
      sourceDocumentId: documentId,
      lines: [
        { accountId: cashAccountId, side: 'DEBIT', amountBase: '250' },
        { accountId: equityAccountId, side: 'CREDIT', amountBase: '250' },
      ],
    });
    const forward = await lineage.forwardLineage(tenantId, 'TEST_DOCUMENT', documentId);
    expect(forward.some((n) => n.nodeType === 'JOURNAL_ENTRY')).toBe(true);
  });

  it('reconstructs a chronological investigation timeline across linked audit events', async () => {
    const eventA = await audit.record({ tenantId, eventType: 'ROLE_ELEVATED', eventCategory: 'SECURITY', entityType: 'TenantMembership', entityId: userId, action: 'PERMISSION_CHANGE', userId });
    const eventB = await audit.record({ tenantId, eventType: 'BANK_DETAIL_CHANGED', eventCategory: 'MASTER_DATA', entityType: 'Counterparty', entityId: 'supplier-1', action: 'UPDATE', userId, causationId: eventA.id });

    const investigation = await investigations.open(tenantId, userId, { title: 'Potential beneficiary change before payment' });
    await investigations.addItem(tenantId, userId, investigation.id, { itemType: 'AUDIT_EVENT', auditEventId: eventA.id });
    await investigations.addItem(tenantId, userId, investigation.id, { itemType: 'AUDIT_EVENT', auditEventId: eventB.id });

    const timeline = await investigations.timeline(tenantId, investigation.id);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].timestamp.getTime()).toBeLessThanOrEqual(timeline[1].timestamp.getTime());

    const causation = await documentAudit.causationChain(tenantId, eventB.id);
    expect(causation.cause?.id).toBe(eventA.id);
  });

  it('blocks retention purge for events under an active legal hold', async () => {
    const heldEvent = await audit.record({ tenantId, organizationId, eventType: 'HELD_ENTITY_UPDATED', eventCategory: 'MASTER_DATA', entityType: 'HeldEntity', entityId: 'held-1', action: 'UPDATE', userId });
    // Force it into the past so it is retention-eligible by date.
    await prisma.auditEvent.update({ where: { id: heldEvent.id }, data: { timestamp: new Date(Date.now() - 400 * 86400000) } });

    await legalHold.create(tenantId, userId, { scope: { organizationId }, reason: 'Pending litigation' });
    await retention.createPolicy(tenantId, { eventCategory: 'MASTER_DATA', retentionPeriodDays: 30 });

    const result = await retention.evaluate(tenantId, organizationId);
    expect(result.heldBack.some((h) => h.eventId === heldEvent.id)).toBe(true);
    expect(result.eligible.some((h) => h.eventId === heldEvent.id)).toBe(false);
  });

  it('detects a tampered audit row via hash-chain verification', async () => {
    const event = await audit.record({ tenantId, eventType: 'TAMPER_TEST', entityType: 'TestEntity', entityId: 'tamper-1', action: 'UPDATE', userId, newValues: { amount: 100 } });
    const before = await integrity.verify(tenantId);
    expect(before.hashMismatches).toHaveLength(0);

    // Simulate direct DB tampering (bypassing the application layer entirely).
    await prisma.auditEvent.update({ where: { id: event.id }, data: { newValues: { amount: 999999 } } });
    const after = await integrity.verify(tenantId);
    expect(after.hashMismatches).toContain(event.id);
    expect(after.valid).toBe(false);
  });

  it('builds a hashed, reproducible export package that can be redacted without touching stored evidence', async () => {
    await audit.record({ tenantId, eventCategory: 'PAYROLL', eventType: 'PAYROLL_TEST_EVENT', entityType: 'Employee', entityId: 'emp-1', action: 'UPDATE', userId, oldValues: { salary: 1000 }, newValues: { salary: 1200 } });

    const fullPackage = await exportService.build(tenantId, userId, { title: 'Evidence bundle', filter: { entityType: 'Employee' }, redact: false });
    expect(fullPackage.packageHash).toBeTruthy();
    expect(fullPackage.eventCount).toBeGreaterThan(0);

    const redactedPackage = await exportService.build(tenantId, userId, { title: 'Evidence bundle (redacted)', filter: { entityType: 'Employee' }, redact: true });
    const redactedPayload = redactedPackage.payload as { events: { newValues: unknown }[] };
    expect(redactedPayload.events[0].newValues).toBe('[REDACTED]');

    // Redaction never alters the underlying stored event.
    const stillRaw = await prisma.auditEvent.findMany({ where: { tenantId, entityType: 'Employee' } });
    expect(stillRaw.some((e) => JSON.stringify(e.newValues).includes('1200'))).toBe(true);
  });
});
