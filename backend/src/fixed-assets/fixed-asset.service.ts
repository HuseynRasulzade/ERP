import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RequestContextService } from '../common/context/request-context.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { AssetStatus, Books, dec, toDate } from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';

export interface CreateCardInput {
  tenantId: string;
  organizationId: string;
  categoryId: string;
  name: string;
  description?: string | null;
  parentAssetId?: string | null;
  componentType?: string | null;
  componentSequence?: number | null;
  groupingType?: string | null;
  quantity?: Decimal.Value;
  acquisitionDate?: Date | null;
  inventoryNumber?: string | null;
  barcode?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  ownershipType?: string | null;
  cipProjectId?: string | null;
  acquisitionSourceType?: string | null;
  createdFromInventoryResultId?: string | null;
  createdBy: string;
}

const MONEY_FIELDS = ['initialCost', 'accumulatedDepreciation', 'impairmentBalance', 'revaluationBalance', 'carryingAmount', 'residualValue'];

/**
 * FixedAssetService (spec sections 15, 38-39, 80-82, 107): the asset card,
 * its components, scanner lookup and the drill-down "card" view assembled
 * from the authoritative registers.
 */
@Injectable()
export class FixedAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ctx: RequestContextService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly documents: FixedAssetDocumentService,
    private readonly accounting: FixedAssetAccountingService,
  ) {}

  canViewCost() {
    return this.ctx.hasPermission(PermissionCodes.FIXED_ASSET_VIEW_COST);
  }

  /** Strips money columns for callers without FIXED_ASSET_VIEW_COST. */
  redact<T extends Record<string, any>>(asset: T): T {
    if (this.canViewCost()) return asset;
    const copy: Record<string, any> = { ...asset };
    for (const f of MONEY_FIELDS) delete copy[f];
    return copy as T;
  }

  async prepareNumbering(tenantId: string) {
    await this.accounting.ensureSetup(tenantId);
    await this.documents.ensureSequence(tenantId, 'FIXED_ASSET');
    await this.documents.ensureSequence(tenantId, 'FIXED_ASSET_INVENTORY_NUMBER');
  }

  /** Creates an asset card in ACQUISITION status (no cost yet — cost only
   * ever arrives through register movements). Caller must have called
   * prepareNumbering before opening the transaction. */
  async createCard(tx: PrismaTransactionClient, input: CreateCardInput) {
    const category = await tx.fixedAssetCategory.findFirst({ where: { id: input.categoryId, tenantId: input.tenantId, active: true } });
    if (!category) throw new NotFoundAppError('FixedAssetCategory', input.categoryId);
    if (category.organizationId && category.organizationId !== input.organizationId) throw new NotFoundAppError('FixedAssetCategory', input.categoryId);
    if (input.parentAssetId) {
      const parent = await tx.fixedAsset.findFirst({ where: { id: input.parentAssetId, tenantId: input.tenantId, organizationId: input.organizationId } });
      if (!parent) throw new NotFoundAppError('FixedAsset', input.parentAssetId);
    }
    if (input.inventoryNumber) await this.assertInventoryNumberFree(tx, input.tenantId, input.organizationId, input.inventoryNumber);
    const date = input.acquisitionDate ?? new Date();
    const assetNumber = await this.documents.allocate(tx, input.tenantId, 'FIXED_ASSET', date);
    const asset = await tx.fixedAsset.create({
      data: {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        assetNumber,
        inventoryNumber: input.inventoryNumber ?? null,
        barcode: input.barcode ?? null,
        name: input.name,
        description: input.description ?? null,
        categoryId: category.id,
        parentAssetId: input.parentAssetId ?? null,
        componentType: input.componentType ?? null,
        componentSequence: input.componentSequence ?? null,
        groupingType: input.groupingType ?? (input.parentAssetId ? 'COMPONENT_ASSET' : category.groupingPolicy),
        quantity: dec(input.quantity ?? 1).toString(),
        acquisitionDate: input.acquisitionDate ?? null,
        status: AssetStatus.ACQUISITION,
        serialNumber: input.serialNumber ?? null,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        ownershipType: input.ownershipType ?? 'OWNED',
        expenseType: category.defaultExpenseType,
        cipProjectId: input.cipProjectId ?? null,
        acquisitionSourceType: input.acquisitionSourceType ?? 'MANUAL',
        createdFromInventoryResultId: input.createdFromInventoryResultId ?? null,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
    });
    await this.audit.record(
      { tenantId: input.tenantId, eventType: 'FIXED_ASSET_CREATED', entityType: 'FixedAsset', entityId: asset.id, action: 'CREATE', userId: input.createdBy, newValues: { assetNumber, name: input.name, categoryId: category.id, source: input.acquisitionSourceType } },
      tx,
    );
    return asset;
  }

  async assertInventoryNumberFree(tx: PrismaTransactionClient, tenantId: string, organizationId: string, inventoryNumber: string, exceptId?: string) {
    const dup = await tx.fixedAsset.findFirst({ where: { tenantId, organizationId, inventoryNumber, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (dup) throw new ConflictAppError(`Inventory number ${inventoryNumber} is already used by asset ${dup.assetNumber}`);
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { name: string; categoryId: string; description?: string; parentAssetId?: string; componentType?: string; componentSequence?: number; quantity?: number; acquisitionDate?: string; inventoryNumber?: string; barcode?: string; serialNumber?: string; manufacturer?: string; model?: string; ownershipType?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.prepareNumbering(tenantId);
    if (dto.parentAssetId) {
      const parent = await this.prisma.fixedAsset.findFirst({ where: { id: dto.parentAssetId, tenantId, organizationId }, include: { category: true } });
      if (!parent) throw new NotFoundAppError('FixedAsset', dto.parentAssetId);
      if (!parent.category.componentizationAllowed) throw new ValidationAppError(`Category ${parent.category.code} does not allow component accounting`);
    }
    const created = await this.prisma.runInTransaction((tx) =>
      this.createCard(tx, {
        tenantId,
        organizationId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        parentAssetId: dto.parentAssetId,
        componentType: dto.componentType,
        componentSequence: dto.componentSequence,
        quantity: dto.quantity,
        acquisitionDate: dto.acquisitionDate ? toDate(dto.acquisitionDate) : null,
        inventoryNumber: dto.inventoryNumber,
        barcode: dto.barcode,
        serialNumber: dto.serialNumber,
        manufacturer: dto.manufacturer,
        model: dto.model,
        ownershipType: dto.ownershipType,
        acquisitionSourceType: 'MANUAL',
        createdBy: userId,
      }),
    );
    return this.redact(created);
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: { expectedVersion: number; name?: string; description?: string; barcode?: string; serialNumber?: string; manufacturer?: string; model?: string; ownershipType?: string; inventoryNumber?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      const asset = await tx.fixedAsset.findFirst({ where: { id, tenantId, organizationId } });
      if (!asset) throw new NotFoundAppError('FixedAsset', id);
      if (dto.inventoryNumber && dto.inventoryNumber !== asset.inventoryNumber) await this.assertInventoryNumberFree(tx, tenantId, organizationId, dto.inventoryNumber, id);
      const { expectedVersion, ...patch } = dto;
      const res = await tx.fixedAsset.updateMany({ where: { id, tenantId, version: expectedVersion }, data: { ...patch, updatedBy: userId, version: { increment: 1 } } });
      if (res.count === 0) throw new ConcurrencyConflictError();
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_UPDATED', entityType: 'FixedAsset', entityId: id, action: 'UPDATE', userId, oldValues: pick(asset, Object.keys(patch)), newValues: patch }, tx);
      return this.redact(await tx.fixedAsset.findUniqueOrThrow({ where: { id } }));
    });
  }

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    filter: { status?: string; categoryId?: string; departmentId?: string; locationId?: string; responsiblePersonId?: string; search?: string; parentAssetId?: string; includeComponents?: boolean },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.fixedAsset.findMany({
      where: {
        tenantId,
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.locationId ? { locationId: filter.locationId } : {}),
        ...(filter.responsiblePersonId ? { responsiblePersonId: filter.responsiblePersonId } : {}),
        ...(filter.parentAssetId ? { parentAssetId: filter.parentAssetId } : {}),
        ...(filter.search
          ? { OR: [{ name: { contains: filter.search, mode: 'insensitive' } }, { assetNumber: { contains: filter.search } }, { inventoryNumber: { contains: filter.search } }, { serialNumber: { contains: filter.search } }] }
          : {}),
      },
      include: { category: { select: { id: true, code: true, name: true } } },
      orderBy: { assetNumber: 'asc' },
      take: 2000,
    });
    return rows.map((r) => this.redact(r));
  }

  /** Scanner lookup (spec section 82): asset number, inventory number,
   * barcode/QR payload or manufacturer serial. */
  async findByCode(tenantId: string, membershipId: string, organizationId: string, code: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.lookupByCode(this.prisma, tenantId, organizationId, code);
    if (!asset) throw new NotFoundAppError('FixedAsset', code);
    return this.redact(asset);
  }

  lookupByCode(client: PrismaTransactionClient, tenantId: string, organizationId: string, code: string) {
    return client.fixedAsset.findFirst({
      where: { tenantId, organizationId, OR: [{ inventoryNumber: code }, { barcode: code }, { assetNumber: code }, { serialNumber: code }] },
      include: { category: { select: { id: true, code: true, name: true } } },
    });
  }

  /** Full asset card (spec sections 84, 85, 104-107, 170 drill-down). */
  async getCard(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, tenantId, organizationId },
      include: {
        category: true,
        parentAsset: { select: { id: true, assetNumber: true, name: true } },
        components: { select: { id: true, assetNumber: true, name: true, componentType: true, componentSequence: true, status: true, initialCost: true, carryingAmount: true, usefulLifeMonths: true } },
        costComponents: { orderBy: { createdAt: 'asc' } },
        bookPolicies: { orderBy: [{ bookCode: 'asc' }, { effectivePeriod: 'asc' }, { createdAt: 'asc' }] },
        assignments: { orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!asset) throw new NotFoundAppError('FixedAsset', id);
    const canCost = this.canViewCost();

    const [balances, taxBalances, movements, documentLines, depreciationLines, parameterHistory, candidates, inventoryResults, auditEvents] = await Promise.all([
      this.ledger.balances(tenantId, id),
      this.ledger.balances(tenantId, id, { book: Books.TAX_BOOK }),
      this.prisma.fixedAssetMovement.findMany({ where: { tenantId, assetId: id }, orderBy: { sequence: 'asc' } }),
      this.prisma.fixedAssetDocumentLine.findMany({ where: { tenantId, assetId: id }, include: { document: true }, orderBy: { document: { documentDate: 'asc' } } }),
      this.prisma.fixedAssetDepreciationLine.findMany({ where: { tenantId, assetId: id, status: { in: ['POSTED', 'REVERSED'] } }, include: { run: { select: { id: true, number: true, status: true, runVersion: true } } }, orderBy: { period: 'asc' } }),
      this.prisma.fixedAssetParameterHistory.findMany({ where: { tenantId, assetId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.fixedAssetAcquisitionCandidate.findMany({ where: { tenantId, OR: [{ assignedAssetId: id }, { id: { in: asset.costComponents.map((c) => c.candidateId).filter((x): x is string => !!x) } }] } }),
      this.prisma.fixedAssetInventoryResult.findMany({ where: { tenantId, assetId: id }, include: { count: { select: { id: true, number: true, countDate: true, status: true } } } }),
      this.prisma.auditEvent.findMany({ where: { tenantId, entityId: id }, orderBy: { timestamp: 'desc' }, take: 200 }),
    ]);

    const journalIds = [...new Set(movements.map((m) => m.journalEntryId).filter((x): x is string => !!x))];
    const journals = journalIds.length
      ? await this.prisma.journalEntry.findMany({ where: { id: { in: journalIds } }, select: { id: true, journalNumber: true, businessDate: true, status: true, sourceDocumentType: true, sourceDocumentId: true, description: true } })
      : [];

    const documents = documentLines.map((l) => ({ ...l.document, line: { ...l, document: undefined } }));
    const repairs = documents.filter((d) => d.documentType === 'FA_REPAIR');
    const modernizations = documents.filter((d) => d.documentType === 'FA_MODERNIZATION');
    const transfers = documents.filter((d) => d.documentType === 'FA_TRANSFER');
    const impairments = documents.filter((d) => ['FA_IMPAIRMENT', 'FA_IMPAIRMENT_REVERSAL', 'FA_REVALUATION'].includes(d.documentType));
    const disposals = documents.filter((d) => d.documentType === 'FA_DISPOSAL');

    // Depreciation history (spec section 106): per period opening NBV,
    // depreciation, adjustment, impairment, closing NBV — from the register.
    const depreciationHistory = depreciationLines.map((l) => ({
      period: l.period,
      runNumber: l.run.number,
      status: l.status,
      openingNbv: l.openingNbv,
      depreciation: l.depreciationAmount,
      accumulatedDepreciation: l.closingAccumulatedDepreciation,
      closingNbv: l.closingNbv,
      remainingLifeBefore: l.remainingLifeBefore,
      departmentId: l.departmentId,
    }));

    const card = {
      ...asset,
      balances: canCost
        ? {
            cost: balances.cost.toString(),
            revaluation: balances.revaluation.toString(),
            grossCarrying: balances.grossCarrying.toString(),
            accumulatedDepreciation: balances.accumulatedDepreciation.toString(),
            impairment: balances.impairment.toString(),
            netBookValue: balances.netBookValue.toString(),
            quantity: balances.quantity.toString(),
            taxBookNetBookValue: taxBalances.accumulatedDepreciation.isZero() && taxBalances.impairment.isZero() ? null : taxBalances.netBookValue.toString(),
          }
        : null,
      candidates,
      movements: canCost ? movements : movements.map((m) => ({ id: m.id, movementType: m.movementType, businessDate: m.businessDate, period: m.period, sourceDocumentType: m.sourceDocumentType, sourceDocumentId: m.sourceDocumentId })),
      journals,
      documents,
      repairs,
      modernizations,
      transfers,
      impairments,
      disposals,
      depreciationHistory,
      parameterHistory,
      inventoryResults,
      auditEvents,
    };
    return this.redact(card);
  }
}

function pick(obj: Record<string, any>, keys: string[]) {
  const out: Record<string, any> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}
