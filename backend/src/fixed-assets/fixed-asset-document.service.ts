import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { PeriodService } from '../period/period.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { FA_DOCUMENT_TYPES, NUMBER_PREFIX, toDate } from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { FixedAssetInvalidStateError } from './fixed-asset.errors';

export type DocumentLineInput = Omit<Prisma.FixedAssetDocumentLineUncheckedCreateInput, 'tenantId' | 'documentId'>;

export interface CreateDocumentInput {
  tenantId: string;
  organizationId: string;
  documentType: string;
  documentDate: Date;
  userId: string;
  description?: string | null;
  reason?: string | null;
  operationKind?: string | null;
  valuationSource?: string | null;
  approvalReference?: string | null;
  counterpartyId?: string | null;
  sourceDocumentType?: string | null;
  sourceDocumentId?: string | null;
  cipProjectId?: string | null;
  bookCode?: string;
  payload?: Record<string, unknown>;
  lines: DocumentLineInput[];
}

export type ReversalHook = (tx: PrismaTransactionClient, doc: Awaited<ReturnType<FixedAssetDocumentService['loadForReversal']>>, userId: string, reversalDate: Date) => Promise<void>;

/**
 * Shared recorder-document infrastructure for every fixed-asset lifecycle
 * operation (acceptance, commissioning, transfer, impairment, disposal ...):
 * transaction-safe numbering, the posted document header + typed lines, and
 * ONE dependency-safe reversal path (spec sections 132-135):
 *   period must be open -> the document must still be the latest effective
 *   operation on each asset -> type-specific undo hook -> compensating
 *   register movements -> reversing Journal Entry -> header CANCELLED.
 * Posted documents and their movements are never deleted.
 */
@Injectable()
export class FixedAssetDocumentService {
  private readonly hooks = new Map<string, ReversalHook>();
  private readonly ensuredSequences = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly periods: PeriodService,
    private readonly audit: AuditService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly history: FixedAssetHistoryService,
    private readonly policies: DepreciationPolicyService,
  ) {}

  registerReversalHook(documentType: string, hook: ReversalHook) {
    this.hooks.set(documentType, hook);
  }

  async ensureSequence(tenantId: string, code: string) {
    const key = `${tenantId}:${code}`;
    if (this.ensuredSequences.has(key)) return;
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (!existing) {
      try {
        await this.prisma.numberSequence.create({
          data: { tenantId, code, documentType: code, prefix: NUMBER_PREFIX[code] ?? code, padding: 6, resetPolicy: code === 'FIXED_ASSET' || code === 'FIXED_ASSET_INVENTORY_NUMBER' ? 'NEVER' : 'YEARLY' },
        });
      } catch {
        // concurrent creation — fine
      }
    }
    this.ensuredSequences.add(key);
  }

  /** Transaction-safe number (NumberingService row lock). Call ensureSequence
   * BEFORE opening the transaction. */
  async allocate(tx: PrismaTransactionClient, tenantId: string, code: string, date: Date) {
    const n = await this.numbering.allocateNumber(tenantId, code, date, tx);
    return n.formatted;
  }

  async prepare(tenantId: string, documentType: string) {
    await this.accounting.ensureSetup(tenantId);
    await this.ensureSequence(tenantId, documentType);
  }

  async create(tx: PrismaTransactionClient, input: CreateDocumentInput) {
    await this.periods.assertDateIsOpen(input.tenantId, input.documentDate, input.organizationId);
    const number = await this.allocate(tx, input.tenantId, input.documentType, input.documentDate);
    const doc = await tx.fixedAssetDocument.create({
      data: {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        documentType: input.documentType,
        number,
        documentDate: input.documentDate,
        postingDate: input.documentDate,
        status: 'ACTIVE',
        postingStatus: 'POSTED',
        description: input.description ?? undefined,
        reason: input.reason ?? undefined,
        operationKind: input.operationKind ?? undefined,
        valuationSource: input.valuationSource ?? undefined,
        approvalReference: input.approvalReference ?? undefined,
        counterpartyId: input.counterpartyId ?? undefined,
        sourceDocumentType: input.sourceDocumentType ?? undefined,
        sourceDocumentId: input.sourceDocumentId ?? undefined,
        cipProjectId: input.cipProjectId ?? undefined,
        bookCode: input.bookCode,
        payload: (input.payload as Prisma.InputJsonValue) ?? undefined,
        createdBy: input.userId,
        updatedBy: input.userId,
        postedAt: new Date(),
        postedBy: input.userId,
      },
    });
    const lines = [];
    for (const [i, line] of input.lines.entries()) {
      lines.push(await tx.fixedAssetDocumentLine.create({ data: { ...line, tenantId: input.tenantId, documentId: doc.id, position: line.position ?? i } }));
    }
    return { ...doc, lines };
  }

  async attachJournal(tx: PrismaTransactionClient, documentId: string, journalEntryId: string | null | undefined) {
    if (!journalEntryId) return;
    await tx.fixedAssetDocument.update({ where: { id: documentId }, data: { journalEntryId } });
  }

  async get(tenantId: string, organizationId: string, id: string) {
    const doc = await this.prisma.fixedAssetDocument.findFirst({ where: { id, tenantId, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!doc) throw new NotFoundAppError('FixedAssetDocument', id);
    return doc;
  }

  list(tenantId: string, organizationId: string, filter: { documentType?: string; assetId?: string }) {
    return this.prisma.fixedAssetDocument.findMany({
      where: {
        tenantId,
        organizationId,
        ...(filter.documentType ? { documentType: filter.documentType } : {}),
        ...(filter.assetId ? { lines: { some: { assetId: filter.assetId } } } : {}),
      },
      include: { lines: true },
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async loadForReversal(tx: PrismaTransactionClient, tenantId: string, organizationId: string, id: string) {
    const doc = await tx.fixedAssetDocument.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
    if (!doc) throw new NotFoundAppError('FixedAssetDocument', id);
    return doc;
  }

  async reverse(tenantId: string, organizationId: string, id: string, userId: string, opts: { reason?: string; reversalDate?: string }) {
    const pre = await this.prisma.fixedAssetDocument.findFirst({ where: { id, tenantId, organizationId } });
    if (!pre) throw new NotFoundAppError('FixedAssetDocument', id);
    if (!FA_DOCUMENT_TYPES.includes(pre.documentType)) throw new NotFoundAppError('FixedAssetDocument', id);
    await this.accounting.ensureSetup(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM fixed_asset_documents WHERE id = ${id} FOR UPDATE`;
      const doc = await this.loadForReversal(tx, tenantId, organizationId, id);
      if (doc.reversedAt || doc.postingStatus !== 'POSTED') {
        throw new FixedAssetInvalidStateError(`Document ${doc.number} is not posted or has already been reversed.`);
      }
      const reversalDate = opts.reversalDate ? toDate(opts.reversalDate) : doc.documentDate;
      await this.periods.assertDateIsOpen(tenantId, reversalDate, organizationId);

      const assetIds = [...new Set(doc.lines.map((l) => l.assetId))];
      for (const assetId of assetIds) {
        await this.ledger.lockAsset(tx, tenantId, assetId);
        // A repair record has no register movement / value effect, so it
        // never blocks and is never blocked by other operations.
        if (doc.documentType === 'FA_REPAIR') continue;
        await this.ledger.assertLatestOperation(tx, tenantId, assetId, doc.documentType, doc.id, `${humanType(doc.documentType)} ${doc.number}`);
      }

      const hook = this.hooks.get(doc.documentType);
      if (hook) await hook(tx, doc, userId, reversalDate);

      let reversalJe: string | null = null;
      if (doc.journalEntryId) {
        const reversed = await this.accounting.reverse(tenantId, doc.journalEntryId, userId, reversalDate, tx);
        reversalJe = reversed?.id ?? null;
      }
      await this.ledger.reverseSource(tx, tenantId, doc.documentType, doc.id, reversalDate, userId, reversalJe);

      for (const assetId of assetIds) {
        await tx.fixedAssetBookPolicy.updateMany({ where: { tenantId, assetId, sourceDocumentType: doc.documentType, sourceDocumentId: doc.id }, data: { reversed: true } });
        await this.history.reverseAssignments(tx, tenantId, assetId, doc.documentType, doc.id);
        const line = doc.lines.find((l) => l.assetId === assetId);
        if (line?.statusBefore) {
          const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id: assetId } });
          await this.history.recordParameter(tx, {
            tenantId, assetId, parameterCode: 'status', oldValue: asset.status, newValue: line.statusBefore, effectiveDate: reversalDate,
            sourceDocumentType: doc.documentType, sourceDocumentId: doc.id, reason: `Reversal: ${opts.reason ?? ''}`.trim(), createdBy: userId,
          });
          await tx.fixedAsset.update({ where: { id: assetId }, data: { status: line.statusBefore } });
        }
        await this.policies.reprojectParameters(tx, tenantId, assetId);
        await this.ledger.refreshProjection(tx, tenantId, assetId);
      }

      const updated = await tx.fixedAssetDocument.update({
        where: { id: doc.id },
        data: {
          status: 'CANCELLED',
          postingStatus: 'NOT_POSTED',
          reversedAt: new Date(),
          reversedBy: userId,
          reversalReason: opts.reason,
          reversalJournalEntryId: reversalJe,
          cancelledAt: new Date(),
          cancelledBy: userId,
          version: { increment: 1 },
        },
        include: { lines: true },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_DOCUMENT_REVERSED',
          entityType: doc.documentType,
          entityId: doc.id,
          action: 'REVERSE',
          userId,
          oldValues: { status: 'POSTED' },
          newValues: { status: 'REVERSED', reversalDate, reversalJournalEntryId: reversalJe },
          reason: opts.reason,
          metadata: { assetIds, number: doc.number },
        },
        tx,
      );
      return updated;
    });
  }
}

export function humanType(documentType: string): string {
  const map: Record<string, string> = {
    FA_ACCEPTANCE: 'Acceptance',
    FA_COMMISSIONING: 'Commissioning',
    FA_PARAMETER_CHANGE: 'Parameter change',
    FA_TRANSFER: 'Transfer',
    FA_MODERNIZATION: 'Modernization',
    FA_REPAIR: 'Repair',
    FA_STATUS_CHANGE: 'Status change',
    FA_IMPAIRMENT: 'Impairment',
    FA_IMPAIRMENT_REVERSAL: 'Impairment reversal',
    FA_REVALUATION: 'Revaluation',
    FA_DISPOSAL: 'Disposal',
    FA_OPENING_BALANCE: 'Opening balance',
  };
  return map[documentType] ?? documentType;
}
