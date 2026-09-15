import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LineageNode {
  nodeType: string; // DOCUMENT|REGISTER_MOVEMENT|COST_LAYER|SETTLEMENT_MOVEMENT|JOURNAL_ENTRY (spec section 79)
  id: string;
  label: string;
  effectiveDate?: Date | null;
}

/**
 * AuditLineageService (docx spec Phase 25, sections 27-30, 76-79).
 * Register/GL/cost lineage is NOT a separately-populated
 * `AuditMovementLineage` projection in this build — every module
 * already writes `sourceDocumentType`/`sourceDocumentId` (or
 * `registrarDocumentType`/`registrarDocumentId`) foreign keys on its own
 * movement tables (`JournalEntry`, `InventoryMovement`,
 * `InventoryCostLayer`, `SettlementMovement`, ...). This service reads
 * those EXISTING references directly (spec section 30's own "Phase 25
 * should expose chain, not recalculate it") rather than duplicating them
 * into a new lineage table — disclosed in docs/AUDIT_TRAIL.md section B,
 * along with this build's scope limit: only ONE HOP forward (source
 * document -> its own directly-generated GL/register/cost effects) and
 * ONE HOP backward (a GL entry -> its own source document) are
 * implemented generically; a full multi-hop chain across several
 * document types (e.g. Material Issue -> Production Order -> Sales
 * Order) would need a per-document-type registry this build does not
 * build.
 */
@Injectable()
export class AuditLineageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything a source document directly caused (spec section 76 —
   * "What did this document affect?"). */
  async forwardLineage(tenantId: string, documentType: string, documentId: string): Promise<LineageNode[]> {
    const nodes: LineageNode[] = [];

    const journalEntries = await this.prisma.journalEntry.findMany({ where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId } });
    for (const je of journalEntries) nodes.push({ nodeType: 'JOURNAL_ENTRY', id: je.id, label: je.journalNumber, effectiveDate: je.businessDate });

    const inventoryMovements = await this.prisma.inventoryMovement.findMany({ where: { tenantId, registrarDocumentType: documentType, registrarDocumentId: documentId } });
    for (const m of inventoryMovements) nodes.push({ nodeType: 'REGISTER_MOVEMENT', id: m.id, label: `${m.movementType} ${m.quantity}`, effectiveDate: m.effectiveDate });

    const costLayers = await this.prisma.inventoryCostLayer.findMany({ where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId } });
    for (const l of costLayers) nodes.push({ nodeType: 'COST_LAYER', id: l.id, label: `Layer ${l.originalQuantity}@${l.originalUnitCost}`, effectiveDate: l.receiptDate });

    const settlementMovements = await this.prisma.settlementMovement.findMany({ where: { tenantId, settlementDocumentType: documentType, settlementDocumentId: documentId } });
    for (const s of settlementMovements) nodes.push({ nodeType: 'SETTLEMENT_MOVEMENT', id: s.id, label: s.movementType, effectiveDate: s.effectiveDate });

    return nodes;
  }

  /** Where a GL entry (or, by extension, an accounting movement) came
   * from (spec section 78 — "Where did this report/account balance come
   * from?"). */
  async backwardFromJournalEntry(tenantId: string, journalEntryId: string): Promise<{ sourceDocumentType: string; sourceDocumentId: string } | null> {
    const entry = await this.prisma.journalEntry.findFirst({ where: { id: journalEntryId, tenantId } });
    if (!entry) return null;
    return { sourceDocumentType: entry.sourceDocumentType, sourceDocumentId: entry.sourceDocumentId };
  }

  /** Financial Report Cell -> mapped GL account -> Inventory Cost ->
   * source document (spec section 180) — chains Phase 23's own
   * `FinancialReportCell` through this service's forward-lineage lookup
   * once the caller has already resolved the cell's underlying account
   * movements (kept as a thin composition, not a duplicated query). */
  async fromAccountingMovements(tenantId: string, accountId: string, businessDateFrom: Date, businessDateTo: Date) {
    const movements = await this.prisma.accountingMovement.findMany({
      where: { tenantId, accountId, businessDate: { gte: businessDateFrom, lte: businessDateTo } },
      include: { journalEntry: { select: { sourceDocumentType: true, sourceDocumentId: true, journalNumber: true } } },
      take: 200,
    });
    return movements.map((m) => ({ movementId: m.id, journalNumber: m.journalEntry.journalNumber, sourceDocumentType: m.journalEntry.sourceDocumentType, sourceDocumentId: m.journalEntry.sourceDocumentId, amountBase: m.amountBase.toString(), side: m.side }));
  }
}
