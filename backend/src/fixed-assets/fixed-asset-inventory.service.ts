import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FaDocumentType, FaSourceType, InventoryResult, RECOGNIZED_STATUSES, toDate } from './fixed-assets.constants';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetTransferService } from './fixed-asset-transfer.service';
import { FixedAssetAcquisitionService } from './fixed-asset-acquisition.service';
import { FixedAssetService } from './fixed-asset.service';
import { validateAssignmentRefs } from './fixed-asset-references';
import { FixedAssetInvalidStateError } from './fixed-asset.errors';

const RESOLUTIONS = ['TRANSFER_CORRECTION', 'FOUND_LATER', 'EMPLOYEE_RECEIVABLE', 'LOSS_EXPENSE', 'LEGAL_INVESTIGATION', 'WRITE_OFF', 'RECOGNITION_REVIEW', 'NO_ACTION'];

/**
 * FixedAssetInventoryService (spec sections 59-64, 113, 120, 160-161):
 * scanner-based physical count. A count NEVER changes values by itself:
 * a wrong location is corrected with a transfer (no write-off), a missing
 * asset goes to investigation (no automatic disposal), an unregistered
 * asset becomes a recognition-review candidate (no automatic asset card).
 */
@Injectable()
export class FixedAssetInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly documents: FixedAssetDocumentService,
    private readonly transfers: FixedAssetTransferService,
    private readonly acquisition: FixedAssetAcquisitionService,
    private readonly assets: FixedAssetService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { countDate: string; branchId?: string; locationId?: string; departmentId?: string; responsiblePersonId?: string; categoryId?: string; comment?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.ensureSequence(tenantId, 'FA_INVENTORY_COUNT');
    const date = toDate(dto.countDate);
    const id = await this.prisma.runInTransaction(async (tx) => {
      await validateAssignmentRefs(tx, tenantId, organizationId, dto);
      const number = await this.documents.allocate(tx, tenantId, 'FA_INVENTORY_COUNT', date);
      const count = await tx.fixedAssetInventoryCount.create({
        data: { tenantId, organizationId, number, countDate: date, branchId: dto.branchId, locationId: dto.locationId, departmentId: dto.departmentId, responsiblePersonId: dto.responsiblePersonId, categoryId: dto.categoryId, comment: dto.comment, createdBy: userId },
      });
      const expected = await tx.fixedAsset.findMany({
        where: {
          tenantId,
          organizationId,
          status: { in: RECOGNIZED_STATUSES },
          ...(dto.branchId ? { branchId: dto.branchId } : {}),
          ...(dto.locationId ? { locationId: dto.locationId } : {}),
          ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
          ...(dto.responsiblePersonId ? { responsiblePersonId: dto.responsiblePersonId } : {}),
          ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        },
      });
      for (const a of expected) {
        await tx.fixedAssetInventoryResult.create({ data: { tenantId, countId: count.id, assetId: a.id, expectedLocationId: a.locationId, expectedResponsiblePersonId: a.responsiblePersonId } });
      }
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_INVENTORY_STARTED', entityType: 'FixedAssetInventoryCount', entityId: count.id, action: 'CREATE', userId, newValues: { number, expected: expected.length } }, tx);
      return count.id;
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetInventoryCount.findMany({ where: { tenantId, organizationId }, orderBy: { countDate: 'desc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const count = await this.prisma.fixedAssetInventoryCount.findFirst({ where: { id, tenantId, organizationId }, include: { results: { orderBy: { createdAt: 'asc' } } } });
    if (!count) throw new NotFoundAppError('FixedAssetInventoryCount', id);
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: count.results.map((r) => r.assetId).filter((x): x is string => !!x) } }, select: { id: true, assetNumber: true, inventoryNumber: true, name: true, serialNumber: true, status: true } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    const summary: Record<string, number> = {};
    for (const r of count.results) summary[r.result] = (summary[r.result] ?? 0) + 1;
    return { ...count, summary, results: count.results.map((r) => ({ ...r, asset: r.assetId ? byId.get(r.assetId) ?? null : null })) };
  }

  /** Scanner input (spec section 113): inventory number / QR / barcode / serial. */
  async scan(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    countId: string,
    userId: string,
    dto: { code: string; foundLocationId?: string; foundResponsiblePersonId?: string; condition?: string; notes?: string; description?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      const count = await tx.fixedAssetInventoryCount.findFirst({ where: { id: countId, tenantId, organizationId } });
      if (!count) throw new NotFoundAppError('FixedAssetInventoryCount', countId);
      if (count.status !== 'IN_PROGRESS') throw new FixedAssetInvalidStateError(`Inventory count ${count.number} is ${count.status}.`);
      await validateAssignmentRefs(tx, tenantId, organizationId, { locationId: dto.foundLocationId, responsiblePersonId: dto.foundResponsiblePersonId });
      const asset = await this.assets.lookupByCode(tx, tenantId, organizationId, dto.code);
      const now = new Date();
      if (!asset) {
        const row = await tx.fixedAssetInventoryResult.create({
          data: { tenantId, countId, scannedCode: dto.code, foundLocationId: dto.foundLocationId, foundResponsiblePersonId: dto.foundResponsiblePersonId, physicallyFound: true, condition: dto.condition, result: InventoryResult.UNREGISTERED_ASSET, description: dto.description, notes: dto.notes, scannedAt: now },
        });
        await this.audit.record({ tenantId, eventType: 'FixedAssetInventoryDifferenceDetected', entityType: 'FixedAssetInventoryCount', entityId: countId, action: 'SCAN', userId, newValues: { result: InventoryResult.UNREGISTERED_ASSET, code: dto.code } }, tx);
        return row;
      }
      const existing = await tx.fixedAssetInventoryResult.findFirst({ where: { countId, assetId: asset.id } });
      const data = { scannedCode: dto.code, foundLocationId: dto.foundLocationId ?? null, foundResponsiblePersonId: dto.foundResponsiblePersonId ?? null, physicallyFound: true, condition: dto.condition ?? 'GOOD', notes: dto.notes, scannedAt: now };
      if (existing) return tx.fixedAssetInventoryResult.update({ where: { id: existing.id }, data });
      // Found here although the count's scope did not expect it (e.g. it sits
      // in another location than the register says).
      return tx.fixedAssetInventoryResult.create({ data: { tenantId, countId, assetId: asset.id, expectedLocationId: asset.locationId, expectedResponsiblePersonId: asset.responsiblePersonId, ...data } });
    });
  }

  /** Completes the count and classifies every line (spec section 61). */
  async complete(tenantId: string, membershipId: string, organizationId: string, countId: string, userId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.prisma.runInTransaction(async (tx) => {
      const count = await tx.fixedAssetInventoryCount.findFirst({ where: { id: countId, tenantId, organizationId }, include: { results: true } });
      if (!count) throw new NotFoundAppError('FixedAssetInventoryCount', countId);
      if (count.status !== 'IN_PROGRESS') throw new FixedAssetInvalidStateError(`Inventory count ${count.number} is ${count.status}.`);
      for (const r of count.results) {
        if (r.result === InventoryResult.UNREGISTERED_ASSET) continue;
        let result: string;
        const issues: string[] = [];
        if (!r.physicallyFound) result = InventoryResult.MISSING;
        else {
          if (r.foundLocationId && r.foundLocationId !== r.expectedLocationId) issues.push(InventoryResult.WRONG_LOCATION);
          if (r.foundResponsiblePersonId && r.foundResponsiblePersonId !== r.expectedResponsiblePersonId) issues.push(InventoryResult.WRONG_RESPONSIBLE_PERSON);
          if (r.condition && r.condition !== 'GOOD') issues.push(InventoryResult.DAMAGED);
          result = issues[0] ?? InventoryResult.FOUND;
        }
        const resolutionStatus = result === InventoryResult.FOUND ? 'RESOLVED' : result === InventoryResult.MISSING ? 'UNDER_INVESTIGATION' : 'OPEN';
        await tx.fixedAssetInventoryResult.update({
          where: { id: r.id },
          data: { result, resolutionStatus, resolution: result === InventoryResult.FOUND ? 'NO_ACTION' : null, description: issues.length > 1 ? `Also: ${issues.slice(1).join(', ')}` : r.description },
        });
        if (result !== InventoryResult.FOUND) {
          await this.audit.record({ tenantId, eventType: 'FixedAssetInventoryDifferenceDetected', entityType: 'FixedAsset', entityId: r.assetId!, action: 'INVENTORY_RESULT', userId, newValues: { countId, result, issues } }, tx);
        }
      }
      await tx.fixedAssetInventoryCount.update({ where: { id: countId }, data: { status: 'COMPLETED', completedAt: new Date(), completedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_INVENTORY_COMPLETED', entityType: 'FixedAssetInventoryCount', entityId: countId, action: 'COMPLETE', userId }, tx);
    });
    return this.get(tenantId, membershipId, organizationId, countId);
  }

  /** Resolution workflow (spec sections 62-64). */
  async resolve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    resultId: string,
    userId: string,
    dto: { resolution: string; date?: string; reason?: string; disposalDocumentId?: string; estimatedValue?: number },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    if (!RESOLUTIONS.includes(dto.resolution)) throw new ValidationAppError(`Unknown resolution ${dto.resolution}`);
    const pre = await this.prisma.fixedAssetInventoryResult.findFirst({ where: { id: resultId, tenantId }, include: { count: true } });
    if (!pre || pre.count.organizationId !== organizationId) throw new NotFoundAppError('FixedAssetInventoryResult', resultId);
    if (pre.resolutionStatus === 'RESOLVED') throw new FixedAssetInvalidStateError('This inventory difference is already resolved.');
    if (dto.resolution === 'TRANSFER_CORRECTION') await this.documents.prepare(tenantId, FaDocumentType.TRANSFER);
    if (dto.resolution === 'RECOGNITION_REVIEW') await this.acquisition.prepare(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const r = await tx.fixedAssetInventoryResult.findUniqueOrThrow({ where: { id: resultId }, include: { count: true } });
      let resolutionDocumentType: string | null = null;
      let resolutionDocumentId: string | null = null;
      let status = 'RESOLVED';
      switch (dto.resolution) {
        case 'TRANSFER_CORRECTION': {
          if (!r.assetId || (r.result !== InventoryResult.WRONG_LOCATION && r.result !== InventoryResult.WRONG_RESPONSIBLE_PERSON)) {
            throw new ValidationAppError('A transfer correction applies to wrong-location / wrong-responsible results only');
          }
          const doc = await this.transfers.transferInTx(tx, tenantId, organizationId, userId, {
            assetIds: [r.assetId],
            date: dto.date ?? r.count.countDate.toISOString().slice(0, 10),
            ...(r.foundLocationId && r.foundLocationId !== r.expectedLocationId ? { toLocationId: r.foundLocationId } : {}),
            ...(r.foundResponsiblePersonId && r.foundResponsiblePersonId !== r.expectedResponsiblePersonId ? { toResponsiblePersonId: r.foundResponsiblePersonId } : {}),
            reason: dto.reason ?? `Inventory count ${r.count.number} correction`,
            sourceDocumentType: FaSourceType.INVENTORY_COUNT,
            sourceDocumentId: r.countId,
          });
          resolutionDocumentType = FaDocumentType.TRANSFER;
          resolutionDocumentId = doc.id;
          break;
        }
        case 'WRITE_OFF': {
          // Never automatic: a posted disposal document must already exist.
          if (!dto.disposalDocumentId) throw new ValidationAppError('Write-off resolution requires the posted disposal document (create the disposal first)');
          const d = await tx.fixedAssetDocument.findFirst({ where: { id: dto.disposalDocumentId, tenantId, documentType: FaDocumentType.DISPOSAL, postingStatus: 'POSTED', lines: { some: { assetId: r.assetId ?? '' } } } });
          if (!d) throw new NotFoundAppError('FixedAssetDocument (posted disposal of this asset)', dto.disposalDocumentId);
          resolutionDocumentType = FaDocumentType.DISPOSAL;
          resolutionDocumentId = d.id;
          break;
        }
        case 'RECOGNITION_REVIEW': {
          if (r.result !== InventoryResult.UNREGISTERED_ASSET) throw new ValidationAppError('Recognition review applies to unregistered assets only');
          const c = await this.acquisition.createCandidate(
            {
              tenantId,
              organizationId,
              sourceDocumentType: FaSourceType.INVENTORY_COUNT,
              sourceDocumentId: r.countId,
              sourceDocumentLineId: r.id,
              sourceDocumentNumber: r.count.number,
              sourceDate: r.count.countDate,
              description: r.description ?? `Unregistered asset found (${r.scannedCode})`,
              transactionAmount: dto.estimatedValue ?? 0,
              baseAmount: dto.estimatedValue ?? 0,
              candidateType: 'INVENTORY_SURPLUS',
              glRecognized: false,
              createdBy: userId,
            },
            tx,
          );
          await tx.fixedAssetAcquisitionCandidate.update({ where: { id: c.id }, data: { status: 'UNDER_REVIEW' } });
          resolutionDocumentType = FaSourceType.CANDIDATE;
          resolutionDocumentId = c.id;
          break;
        }
        case 'LEGAL_INVESTIGATION':
        case 'EMPLOYEE_RECEIVABLE':
        case 'LOSS_EXPENSE':
          // Financial settlement belongs to payroll / disposal documents
          // (Phase 17-19 boundary) — the result stays under investigation.
          status = 'UNDER_INVESTIGATION';
          break;
        default:
          break;
      }
      const updated = await tx.fixedAssetInventoryResult.update({
        where: { id: resultId },
        data: { resolution: dto.resolution, resolutionStatus: status, resolutionDocumentType, resolutionDocumentId, resolvedAt: status === 'RESOLVED' ? new Date() : null, resolvedBy: status === 'RESOLVED' ? userId : null, notes: dto.reason ?? r.notes },
      });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_INVENTORY_RESULT_RECORDED', entityType: 'FixedAssetInventoryResult', entityId: resultId, action: 'RESOLVE', userId, oldValues: { result: r.result, resolutionStatus: r.resolutionStatus }, newValues: { resolution: dto.resolution, resolutionStatus: status, resolutionDocumentId }, reason: dto.reason }, tx);
      return updated;
    });
  }
}
