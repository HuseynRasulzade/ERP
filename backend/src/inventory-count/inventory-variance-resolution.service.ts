import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, PermissionDeniedError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { DEFAULT_REASON_CODES } from './inventory-count.constants';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryCountEventsService } from './inventory-count-events.service';
import { CreateReasonCodeDto, UpdateVarianceDto } from './dto/inventory-count.dto';

const CORRECTION_FOR_MATCH: Record<string, string> = {
  LOCATION_MISMATCH: 'LOCATION_TRANSFER',
  QUALITY_STATUS_MISMATCH: 'STATUS_TRANSFER',
  BATCH_MISMATCH: 'BATCH_CORRECTION',
  SERIAL_MISMATCH: 'SERIAL_CORRECTION',
};

/**
 * InventoryVarianceResolutionService (spec sections 41, 44-46, 49-50, 54).
 * Investigation status, reason codes (configurable catalog), resolution
 * decisions (append-only InventoryVarianceDecision rows), supervisor-
 * confirmed final quantity, surplus manual cost, and the shortage
 * responsible-person reference. Every change is audited with old/new values.
 */
@Injectable()
export class InventoryVarianceResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly variances: InventoryVarianceService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async update(tenantId: string, membershipId: string, organizationId: string, planId: string, varianceId: string, userId: string, dto: UpdateVarianceDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['UNDER_REVIEW', 'RECOUNT_REQUIRED'], 'change a variance');
    const v = await this.prisma.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId: session.id }, include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!v) throw new NotFoundAppError('InventoryVariance', varianceId);
    const last = v.decisions[0] ?? null;

    if (dto.reasonCode) await this.assertReasonCode(tenantId, dto.reasonCode);
    if (dto.finalPhysicalQty !== undefined && !this.sessions.hasPermission(PermissionCodes.INVENTORY_COUNT_OVERRIDE_VARIANCE)) throw new PermissionDeniedError(PermissionCodes.INVENTORY_COUNT_OVERRIDE_VARIANCE);
    if (dto.approvedCost !== undefined) {
      if (!this.sessions.hasPermission(PermissionCodes.INVENTORY_COUNT_OVERRIDE_VARIANCE)) throw new PermissionDeniedError(PermissionCodes.INVENTORY_COUNT_OVERRIDE_VARIANCE);
      if (!this.sessions.canSeeCost()) throw new PermissionDeniedError(PermissionCodes.INVENTORY_COUNT_VIEW_COST);
      if (new Decimal(v.quantityDifference.toString()).lte(0)) throw new ValidationAppError('A shortage is always costed from actual inventory cost; a manual cost is only allowed for a surplus.');
      if (plan.surplusCostPolicy !== 'MANUAL_APPROVED') throw new ValidationAppError('This count values surplus by policy; switch the plan to MANUAL_APPROVED surplus costing to enter a manual cost.');
    }
    if (dto.resolutionType && Object.values(CORRECTION_FOR_MATCH).includes(dto.resolutionType)) {
      const matches = await this.prisma.inventoryVarianceMatch.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, OR: [{ shortageVarianceId: v.id }, { surplusVarianceId: v.id }] } });
      if (!matches.some((m) => CORRECTION_FOR_MATCH[m.matchType] === dto.resolutionType)) throw new ValidationAppError(`${dto.resolutionType} needs an offsetting variance line (none was matched for this line)`);
    }
    if ((dto.responsibleEmployeeId || dto.recoverableAmount !== undefined) && new Decimal(v.quantityDifference.toString()).gte(0)) {
      throw new ValidationAppError('A responsible person / recoverable amount can only be assigned to a shortage');
    }

    const needsRecalc = dto.finalPhysicalQty !== undefined || dto.approvedCost !== undefined;
    return this.prisma.runInTransaction(async (tx) => {
      const patch: Record<string, unknown> = {};
      if (dto.reasonCode !== undefined) patch.reasonCode = dto.reasonCode;
      if (dto.investigationNotes !== undefined) patch.investigationNotes = dto.investigationNotes;
      if (dto.investigationStatus && dto.investigationStatus !== 'RECOUNT_REQUIRED' && !['APPROVED', 'POSTED'].includes(dto.investigationStatus)) patch.resolutionStatus = dto.investigationStatus;
      if (dto.responsibleEmployeeId !== undefined) patch.responsibleEmployeeId = dto.responsibleEmployeeId;
      if (dto.recoverableAmount !== undefined) {
        patch.recoverableAmount = new Decimal(dto.recoverableAmount).toString();
        patch.recoveryStatus = dto.recoverableAmount > 0 ? 'PENDING' : 'NOT_APPLICABLE';
      }
      if (Object.keys(patch).length > 0) await tx.inventoryVariance.update({ where: { id: v.id }, data: { ...patch, version: { increment: 1 } } });

      if (dto.resolutionType || dto.finalPhysicalQty !== undefined || dto.approvedCost !== undefined || dto.reasonCode) {
        await tx.inventoryVarianceDecision.create({
          data: {
            tenantId,
            varianceId: v.id,
            resolutionType: dto.resolutionType ?? last?.resolutionType ?? v.suggestedResolution ?? 'ADJUST_STOCK',
            finalPhysicalQty: dto.finalPhysicalQty !== undefined ? new Decimal(dto.finalPhysicalQty).toString() : last?.finalPhysicalQty ?? null,
            approvedCost: dto.approvedCost !== undefined ? new Decimal(dto.approvedCost).toString() : last?.approvedCost ?? null,
            reasonCode: dto.reasonCode ?? last?.reasonCode ?? v.reasonCode,
            decidedBy: userId,
            comment: dto.comment,
          },
        });
      }

      if (dto.reasonCode !== undefined && dto.reasonCode !== v.reasonCode) {
        await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_VARIANCE_REASON_CHANGED', entityType: 'INVENTORY_VARIANCE', entityId: v.id, action: 'UPDATE', userId, oldValues: { reasonCode: v.reasonCode }, newValues: { reasonCode: dto.reasonCode } }, tx);
      }
      if (dto.approvedCost !== undefined) {
        await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_COST_OVERRIDDEN', entityType: 'INVENTORY_VARIANCE', entityId: v.id, action: 'COST_OVERRIDE', userId, oldValues: { unitCost: v.unitCost?.toString() ?? null, costSource: v.costSource }, newValues: { approvedCost: String(dto.approvedCost) }, reason: dto.comment }, tx);
      }
      if (dto.finalPhysicalQty !== undefined) {
        await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_FINAL_QUANTITY_OVERRIDDEN', entityType: 'INVENTORY_VARIANCE', entityId: v.id, action: 'OVERRIDE', userId, oldValues: { physicalQuantity: v.physicalQuantity?.toString() ?? null }, newValues: { finalPhysicalQty: String(dto.finalPhysicalQty) }, reason: dto.comment }, tx);
      }
      if (dto.resolutionType || dto.investigationStatus) {
        await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_VARIANCE_DECIDED', entityType: 'INVENTORY_VARIANCE', entityId: v.id, action: 'DECIDE', userId, oldValues: { resolutionStatus: v.resolutionStatus, resolutionType: last?.resolutionType ?? null }, newValues: { resolutionStatus: patch.resolutionStatus ?? v.resolutionStatus, resolutionType: dto.resolutionType ?? null }, reason: dto.comment }, tx);
      }

      if (needsRecalc) {
        const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id, tx);
        const fresh = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
        await this.variances.persist(tenantId, plan, fresh, scope, userId, tx);
      }
      return tx.inventoryVariance.findFirst({ where: { id: v.id }, include: { decisions: { orderBy: { createdAt: 'desc' } } } });
    });
  }

  async history(tenantId: string, membershipId: string, organizationId: string, planId: string, varianceId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const v = await this.prisma.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId: session.id }, include: { decisions: { orderBy: { createdAt: 'asc' } }, recounts: { orderBy: { recountNumber: 'asc' } } } });
    if (!v) throw new NotFoundAppError('InventoryVariance', varianceId);
    const entries = v.lineKey.startsWith('unknown:')
      ? await this.prisma.inventoryCountEntry.findMany({ where: { id: v.lineKey.slice(8) }, include: { versions: true } })
      : await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId: session.id, lineKey: v.lineKey }, include: { versions: { orderBy: { entryVersion: 'asc' } } } });
    const [enriched] = await this.variances.enrich(tenantId, session, [v]);
    return { variance: enriched, entries, recounts: v.recounts, decisions: this.sessions.canSeeCost() ? v.decisions : v.decisions.map((d) => ({ ...d, approvedCost: undefined })) };
  }

  // -- reason catalog (spec section 45) --------------------------------------

  async listReasonCodes(tenantId: string) {
    await this.ensureDefaults(tenantId);
    return this.prisma.inventoryCountReasonCode.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async createReasonCode(tenantId: string, userId: string, dto: CreateReasonCodeDto) {
    await this.ensureDefaults(tenantId);
    const existing = await this.prisma.inventoryCountReasonCode.findUnique({ where: { tenantId_code: { tenantId, code: dto.code } } });
    if (existing) throw new ValidationAppError(`Reason code ${dto.code} already exists`);
    const row = await this.prisma.inventoryCountReasonCode.create({ data: { tenantId, code: dto.code, name: dto.name, description: dto.description } });
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_REASON_CODE_CREATED', entityType: 'INVENTORY_COUNT_REASON_CODE', entityId: row.id, action: 'CREATE', userId, newValues: dto as any });
    return row;
  }

  private async assertReasonCode(tenantId: string, code: string) {
    await this.ensureDefaults(tenantId);
    const row = await this.prisma.inventoryCountReasonCode.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (!row || !row.active) throw new ValidationAppError(`Unknown variance reason code ${code}`);
  }

  private async ensureDefaults(tenantId: string) {
    const count = await this.prisma.inventoryCountReasonCode.count({ where: { tenantId } });
    if (count > 0) return;
    await this.prisma.inventoryCountReasonCode.createMany({ data: DEFAULT_REASON_CODES.map((r) => ({ tenantId, ...r })), skipDuplicates: true });
  }
}
