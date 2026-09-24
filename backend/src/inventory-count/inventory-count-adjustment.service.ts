import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_COUNT_ADJUSTMENT_TYPE, INVENTORY_COUNT_SESSION_TYPE, dec } from './inventory-count.constants';
import { CountInvalidStateError, CountRecountPendingError, CountStaleError } from './inventory-count.errors';
import { InventoryCountSessionService, PlanRow, SessionRow } from './inventory-count-session.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';
import { CreateAdjustmentsDto } from './dto/inventory-count.dto';

const ADJUSTING = ['ADJUST_STOCK', 'WRITE_OFF', 'SURPLUS_RECOGNITION', 'LOCATION_TRANSFER', 'STATUS_TRANSFER', 'BATCH_CORRECTION', 'SERIAL_CORRECTION'];
const CORRECTION_BY_MATCH: Record<string, { resolution: string; operation: string }> = {
  LOCATION_MISMATCH: { resolution: 'LOCATION_TRANSFER', operation: 'LOCATION_CORRECTION' },
  QUALITY_STATUS_MISMATCH: { resolution: 'STATUS_TRANSFER', operation: 'STATUS_CORRECTION' },
  BATCH_MISMATCH: { resolution: 'BATCH_CORRECTION', operation: 'BATCH_CORRECTION' },
  SERIAL_MISMATCH: { resolution: 'SERIAL_CORRECTION', operation: 'SERIAL_CORRECTION' },
};
const SEQUENCE_PREFIX = 'ICA';

interface DraftLine {
  operationType: string;
  warehouseId: string;
  varianceId: string;
  counterVarianceId?: string;
  productId: string;
  unitId: string;
  quantity: Decimal;
  batchId: string | null;
  toBatchId?: string | null;
  serialId: string | null;
  toSerialId?: string | null;
  locationId: string | null;
  toLocationId?: string | null;
  stockStatus: string;
  toStockStatus?: string | null;
  ownershipType: string;
  ownerCounterpartyId: string | null;
  expectedAdjustedQty: Decimal;
  approvedCost: Decimal | null;
  reasonCode: string | null;
  responsibleEmployeeId: string | null;
  recoverableAmount: Decimal | null;
}

/**
 * InventoryAdjustmentService for counts (spec sections 50-61, 129-131).
 *
 * `createAdjustments` picks the correct document type per approved
 * decision — a matched location/status/batch/serial offset becomes a
 * correction document (no financial variance); only the real residual
 * becomes an INVENTORY_SURPLUS / INVENTORY_SHORTAGE document. Documents are
 * keyed by a unique posting key (session × operation × warehouse), so a
 * repeated call returns the same documents.
 *
 * `postAdjustments` performs the pre-post refresh (pending recounts,
 * approval, stale-result detection per the plan's stale policy) and then
 * posts every document through the generic document framework (period
 * lock, handler validation incl. costing, movements, GL, audit — each
 * atomically). Already-posted documents are skipped, so the command is
 * idempotent and safely resumable.
 */
@Injectable()
export class InventoryCountAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly posting: DocumentPostingService,
    private readonly sessions: InventoryCountSessionService,
    private readonly variances: InventoryVarianceService,
    private readonly snapshots: InventorySnapshotService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const docs = await this.prisma.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId: session.id }, include: { lines: { orderBy: { position: 'asc' } } }, orderBy: { createdAt: 'asc' } });
    if (this.sessions.canSeeCost()) return docs;
    return docs.map((d) => ({ ...d, totalValue: undefined, lines: d.lines.map((l) => ({ ...l, unitCost: undefined, amount: undefined, approvedCost: undefined, recoverableAmount: undefined })) }));
  }

  async createAdjustments(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, dto: CreateAdjustmentsDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['APPROVED', 'POSTED'], 'create adjustments');
    const existing = await this.prisma.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId: session.id, status: { not: 'CANCELLED' } }, include: { lines: true } });
    if (existing.length > 0) return { created: false, documents: existing };

    const documentDate = this.adjustmentDate(plan, session, dto);
    const drafts = await this.buildDraftLines(tenantId, session);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      // Found serials without master data become SerialNumber rows now
      // (approved result), never at counting time.
      for (const d of drafts) {
        for (const field of ['serialId', 'toSerialId'] as const) {
          const v = d[field];
          if (v && v.startsWith('sn:')) d[field] = await this.ensureSerial(tenantId, organizationId, d.productId, v.slice(3), userId, tx);
        }
      }
      const groups = new Map<string, DraftLine[]>();
      for (const d of drafts) {
        const k = `${d.operationType}|${d.warehouseId}`;
        const list = groups.get(k) ?? [];
        list.push(d);
        groups.set(k, list);
      }
      const documents = [];
      for (const [key, lines] of groups) {
        const [operationType, warehouseId] = key.split('|');
        const allocated = await this.numbering.allocateNumber(tenantId, INVENTORY_COUNT_ADJUSTMENT_TYPE, documentDate, tx);
        const doc = await tx.inventoryCountAdjustment.create({
          data: {
            tenantId,
            organizationId,
            sessionId: session.id,
            warehouseId,
            operationType,
            postingKey: `${session.id}:${operationType}:${warehouseId}`,
            number: allocated.formatted,
            documentDate,
            totalQuantity: lines.reduce((s, l) => s.plus(l.quantity), new Decimal(0)).toString(),
            description: `${operationType} from inventory count ${session.sessionNumber}`,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        for (const [i, l] of lines.entries()) {
          await tx.inventoryCountAdjustmentLine.create({
            data: {
              tenantId,
              adjustmentId: doc.id,
              position: i,
              varianceId: l.varianceId,
              counterVarianceId: l.counterVarianceId,
              productId: l.productId,
              unitId: l.unitId,
              quantity: l.quantity.toString(),
              batchId: l.batchId,
              toBatchId: l.toBatchId ?? null,
              serialId: l.serialId,
              toSerialId: l.toSerialId ?? null,
              locationId: l.locationId,
              toLocationId: l.toLocationId ?? null,
              stockStatus: l.stockStatus,
              toStockStatus: l.toStockStatus ?? null,
              ownershipType: l.ownershipType,
              ownerCounterpartyId: l.ownerCounterpartyId,
              expectedAdjustedQty: l.expectedAdjustedQty.toString(),
              approvedCost: l.approvedCost?.toString() ?? null,
              reasonCode: l.reasonCode,
              responsibleEmployeeId: l.responsibleEmployeeId,
              recoverableAmount: l.recoverableAmount?.toString() ?? null,
            },
          });
        }
        documents.push(doc);
        await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_ADJUSTMENT_CREATED', entityType: INVENTORY_COUNT_ADJUSTMENT_TYPE, entityId: doc.id, action: 'CREATE', userId, newValues: { number: doc.number, operationType, warehouseId, lineCount: lines.length, sessionId: session.id } }, tx);
      }
      await tx.inventoryCountSession.update({ where: { id: session.id }, data: { adjustmentDate: documentDate } });
      const full = await tx.inventoryCountAdjustment.findMany({ where: { id: { in: documents.map((d) => d.id) } }, include: { lines: true } });
      return { created: true, documents: full };
    });
  }

  async postAdjustments(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    if (session.status === 'POSTED' || session.status === 'RECONCILED' || session.status === 'CLOSED') {
      const docs = await this.prisma.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId: session.id, status: { not: 'CANCELLED' } } });
      return { alreadyPosted: true, posted: 0, documents: docs };
    }
    this.sessions.assertStatus(session, ['APPROVED'], 'post adjustments');
    await this.prePostRefresh(tenantId, plan, session);

    let docs = await this.prisma.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId: session.id, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } });
    if (docs.length === 0) {
      const needed = await this.buildDraftLines(tenantId, session);
      if (needed.length > 0) throw new CountInvalidStateError('Create the adjustment documents first (create-adjustments).');
    }
    let posted = 0;
    for (const doc of docs) {
      if (doc.postingStatus === 'POSTED') continue;
      await this.posting.post(tenantId, INVENTORY_COUNT_ADJUSTMENT_TYPE, doc.id, doc.version, userId);
      posted += 1;
    }
    docs = await this.prisma.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId: session.id, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } });

    return this.prisma.runInTransaction(async (tx) => {
      const fresh = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
      const updated = await this.sessions.updateSession(tx, fresh, { status: 'POSTED', postedAt: new Date(), reconciliationStatus: 'IN_PROGRESS' });
      await tx.inventoryVariance.updateMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, resolutionStatus: 'APPROVED' }, data: { resolutionStatus: 'POSTED' } });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_ADJUSTMENTS_POSTED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'POST_ADJUSTMENTS', userId, newValues: { documents: docs.map((d) => d.number), posted } }, tx);
      await this.events.emit(tenantId, InventoryCountEvents.ADJUSTMENT_POSTED, { sessionId: session.id, planId: plan.id }, { documents: docs.map((d) => ({ id: d.id, number: d.number, operationType: d.operationType })) }, tx);
      return { alreadyPosted: false, posted, session: updated, documents: docs };
    });
  }

  /** Pre-post refresh (spec sections 57, 59-60, 130). */
  async prePostRefresh(tenantId: string, plan: PlanRow, session: SessionRow) {
    const pending = await this.prisma.inventoryRecount.count({ where: { tenantId, sessionId: session.id, resultStatus: 'PENDING' } });
    if (pending > 0) throw new CountRecountPendingError(pending);
    if (!['APPROVED', 'NOT_REQUIRED'].includes(session.approvalStatus) || !session.approvedAt) throw new CountInvalidStateError('Inventory count variances must be approved before posting.');

    const scope = await this.sessions.resolveScope(tenantId, session.organizationId, plan.id);
    const own = await this.sessions.ownAdjustmentIds(tenantId, session.id);
    if (plan.stalePolicy === 'BLOCK') {
      const after = await this.snapshots.getMovementsAfter(tenantId, session.organizationId, scope, session.approvedAt, null, own);
      if (after.length > 0) {
        throw new CountStaleError({ movements: after.slice(0, 20).map((m) => ({ registrarDocumentType: m.registrarDocumentType, registrarDocumentId: m.registrarDocumentId, productId: m.productId, quantity: m.quantity.toString(), recordedAt: m.recordedAt })) });
      }
    }
    const { lines } = await this.variances.compute(tenantId, plan, session, scope);
    const approved = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, resolutionStatus: { not: 'SUPERSEDED' } } });
    const byKey = new Map(lines.map((l) => [l.lineKey, l]));
    const changed: { lineKey: string; approvedAdjusted: string; currentAdjusted: string }[] = [];
    for (const v of approved) {
      const cur = byKey.get(v.lineKey);
      const curAdjusted = cur ? cur.adjusted : new Decimal(0);
      const curPhysical = cur ? cur.physical : null;
      if (!curAdjusted.eq(dec(v.adjustedAccountingQuantity)) || (curPhysical?.toString() ?? null) !== (v.physicalQuantity != null ? dec(v.physicalQuantity).toString() : null)) {
        changed.push({ lineKey: v.lineKey, approvedAdjusted: v.adjustedAccountingQuantity.toString(), currentAdjusted: curAdjusted.toString() });
      }
    }
    const approvedKeys = new Set(approved.map((v) => v.lineKey));
    for (const l of lines) if (!approvedKeys.has(l.lineKey) && !l.diff.isZero()) changed.push({ lineKey: l.lineKey, approvedAdjusted: '0', currentAdjusted: l.adjusted.toString() });
    if (changed.length > 0) throw new CountStaleError({ changedLines: changed });
  }

  /** Correct adjustment type selection (spec section 50). */
  private async buildDraftLines(tenantId: string, session: SessionRow): Promise<DraftLine[]> {
    const variances = await this.prisma.inventoryVariance.findMany({
      where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, resolutionStatus: { in: ['APPROVED', 'POSTED'] } },
      include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const matches = await this.prisma.inventoryVarianceMatch.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion } });
    const byId = new Map(variances.map((v) => [v.id, v]));
    const resolution = (v: (typeof variances)[number]) => v.decisions[0]?.resolutionType ?? v.suggestedResolution ?? 'NO_ADJUSTMENT';
    const serialRef = (v: (typeof variances)[number]) => v.serialId ?? (v.serialNumberText ? `sn:${v.serialNumberText}` : null);
    const consumed = new Map<string, Decimal>();
    const out: DraftLine[] = [];

    for (const m of matches) {
      const s = byId.get(m.shortageVarianceId);
      const p = byId.get(m.surplusVarianceId);
      const corr = CORRECTION_BY_MATCH[m.matchType];
      if (!s || !p || !corr || !s.productId) continue;
      if (resolution(s) !== corr.resolution || resolution(p) !== corr.resolution) continue;
      const q = dec(m.quantity);
      out.push({
        operationType: corr.operation,
        warehouseId: s.warehouseId,
        varianceId: s.id,
        counterVarianceId: p.id,
        productId: s.productId,
        unitId: s.unitId!,
        quantity: q,
        batchId: s.batchId,
        toBatchId: p.batchId,
        serialId: serialRef(s),
        toSerialId: serialRef(p),
        locationId: s.locationId,
        toLocationId: p.locationId,
        stockStatus: s.stockStatus,
        toStockStatus: p.stockStatus,
        ownershipType: s.ownershipType,
        ownerCounterpartyId: s.ownerCounterpartyId,
        expectedAdjustedQty: dec(s.adjustedAccountingQuantity),
        approvedCost: null,
        reasonCode: s.decisions[0]?.reasonCode ?? s.reasonCode,
        responsibleEmployeeId: null,
        recoverableAmount: null,
      });
      consumed.set(s.id, (consumed.get(s.id) ?? new Decimal(0)).plus(q));
      consumed.set(p.id, (consumed.get(p.id) ?? new Decimal(0)).plus(q));
    }

    for (const v of variances) {
      if (!v.productId || !ADJUSTING.includes(resolution(v))) continue;
      const diff = dec(v.quantityDifference);
      if (diff.isZero()) continue;
      const residual = diff.abs().minus(consumed.get(v.id) ?? new Decimal(0));
      if (residual.lte(0)) continue;
      out.push({
        operationType: diff.gt(0) ? 'INVENTORY_SURPLUS' : 'INVENTORY_SHORTAGE',
        warehouseId: v.warehouseId,
        varianceId: v.id,
        productId: v.productId,
        unitId: v.unitId!,
        quantity: residual,
        batchId: v.batchId,
        serialId: serialRef(v),
        locationId: v.locationId,
        stockStatus: v.stockStatus,
        ownershipType: v.ownershipType,
        ownerCounterpartyId: v.ownerCounterpartyId,
        expectedAdjustedQty: dec(v.adjustedAccountingQuantity),
        approvedCost: v.decisions[0]?.approvedCost != null ? dec(v.decisions[0].approvedCost) : null,
        reasonCode: v.decisions[0]?.reasonCode ?? v.reasonCode,
        responsibleEmployeeId: diff.lt(0) ? v.responsibleEmployeeId : null,
        recoverableAmount: diff.lt(0) && v.recoverableAmount != null ? dec(v.recoverableAmount) : null,
      });
    }
    return out;
  }

  /** Adjustment accounting date (spec section 61) — policy-driven, never hard-coded. */
  private adjustmentDate(plan: PlanRow, session: SessionRow, dto: CreateAdjustmentsDto): Date {
    if (plan.adjustmentDatePolicy === 'EXPLICIT_DATE') {
      if (!dto.adjustmentDate) throw new ValidationAppError('This count uses EXPLICIT_DATE adjustment policy: adjustmentDate is required');
      return new Date(dto.adjustmentDate);
    }
    if (plan.adjustmentDatePolicy === 'COMPLETION_DATE') return this.dateOnly(session.completedAt ?? new Date());
    // SNAPSHOT_DATE: the count date. An explicit override is still accepted
    // for a special year-end close policy.
    if (dto.adjustmentDate) return new Date(dto.adjustmentDate);
    return this.dateOnly(session.snapshotAt ?? new Date());
  }

  private dateOnly(d: Date) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private async ensureSerial(tenantId: string, organizationId: string, productId: string, serialNumber: string, userId: string, tx: PrismaTransactionClient) {
    const existing = await tx.serialNumber.findFirst({ where: { tenantId, organizationId, productId, serialNumber } });
    if (existing) return existing.id;
    const created = await tx.serialNumber.create({ data: { tenantId, organizationId, productId, serialNumber, status: 'MISSING', createdBy: userId } });
    return created.id;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INVENTORY_COUNT_ADJUSTMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INVENTORY_COUNT_ADJUSTMENT_TYPE, documentType: INVENTORY_COUNT_ADJUSTMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // lost the race — fine
    }
  }
}
