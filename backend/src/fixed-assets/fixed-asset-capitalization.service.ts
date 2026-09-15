import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FIXED_ASSET_CAPITALIZATION_TYPE } from './fixed-asset-capitalization.repository';

const SEQUENCE_PREFIX = 'FACAP';
const ASSET_SEQUENCE_PREFIX = 'FA';

/**
 * FixedAssetCapitalizationService — creates the FixedAsset row (status
 * ACQUISITION, no GL/subledger effect yet) and its matching
 * FixedAssetCapitalization document (DRAFT) in one transaction; posting
 * the document (via the shared DocumentPostingService) is what actually
 * recognizes the cost (spec sections 15, 88-90). Supports both spec
 * section 12 (multiple cost lines/candidates -> one asset) and, when
 * called once per desired unit, spec section 13's "one source -> multiple
 * assets" (the caller invokes `capitalize` once per resulting asset,
 * splitting `costLineIds`/`candidateIds` accordingly — this build does
 * not auto-split a single invoice line into N identical assets, disclosed
 * simplification, see docs/FIXED_ASSETS.md).
 */
@Injectable()
export class FixedAssetCapitalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async capitalize(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: {
      name: string;
      description?: string;
      categoryId: string;
      cipProjectId?: string;
      costLineIds?: string[];
      candidateIds?: string[];
      directAmount?: number;
      currencyId: string;
      acquisitionDate: string;
      documentDate: string;
      serialNumber?: string;
      manufacturer?: string;
      model?: string;
      departmentId?: string;
      responsiblePersonId?: string;
      locationId?: string;
      usefulLifeMonths?: number;
      depreciationMethod?: string;
      residualValue?: number;
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const documentDate = this.parseDate(dto.documentDate);
    const acquisitionDate = this.parseDate(dto.acquisitionDate);

    let costLines: { id: string; baseAmount: any }[] = [];
    if (dto.costLineIds?.length) {
      costLines = await this.prisma.capitalInvestmentCostLine.findMany({ where: { tenantId, id: { in: dto.costLineIds }, capitalizable: true, capitalizedToAssetId: null } });
      if (costLines.length !== dto.costLineIds.length) throw new ValidationAppError('One or more cost lines are missing, non-capitalizable, or already capitalized');
    }
    let candidates: { id: string; capitalizableAmount: any; baseAmount: any }[] = [];
    if (dto.candidateIds?.length) {
      candidates = await this.prisma.fixedAssetAcquisitionCandidate.findMany({ where: { tenantId, id: { in: dto.candidateIds }, status: { in: ['CAPITALIZABLE', 'ASSIGNED_TO_ASSET'] } } });
      if (candidates.length !== dto.candidateIds.length) throw new ValidationAppError('One or more candidates are missing or not in a capitalizable status');
    }

    const amount = costLines.length
      ? costLines.reduce((s, l) => s.plus(l.baseAmount.toString()), new Decimal(0))
      : candidates.length
        ? candidates.reduce((s, c) => s.plus(new Decimal(c.capitalizableAmount.toString()).gt(0) ? c.capitalizableAmount.toString() : c.baseAmount.toString()), new Decimal(0))
        : new Decimal(dto.directAmount ?? 0);
    if (amount.lte(0)) throw new ValidationAppError('Capitalization amount must be positive — provide costLineIds, candidateIds, or directAmount');

    await this.ensureSequences(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const assetNumber = await this.numbering.allocateNumber(tenantId, 'FIXED_ASSET', acquisitionDate, tx);
      const asset = await tx.fixedAsset.create({
        data: {
          tenantId,
          organizationId,
          assetNumber: assetNumber.formatted,
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId,
          cipProjectId: dto.cipProjectId,
          acquisitionDate,
          currencyId: dto.currencyId,
          serialNumber: dto.serialNumber,
          manufacturer: dto.manufacturer,
          model: dto.model,
          departmentId: dto.departmentId,
          responsiblePersonId: dto.responsiblePersonId,
          locationId: dto.locationId,
          usefulLifeMonths: dto.usefulLifeMonths,
          remainingUsefulLifeMonths: dto.usefulLifeMonths,
          depreciationMethod: dto.depreciationMethod ?? 'STRAIGHT_LINE',
          residualValue: (dto.residualValue ?? 0).toString(),
          status: 'ACQUISITION',
          createdBy: userId,
          updatedBy: userId,
        },
      });

      if (costLines.length) await tx.capitalInvestmentCostLine.updateMany({ where: { id: { in: costLines.map((l) => l.id) } }, data: { capitalizedToAssetId: asset.id } });
      if (candidates.length) await tx.fixedAssetAcquisitionCandidate.updateMany({ where: { id: { in: candidates.map((c) => c.id) } }, data: { status: 'ASSIGNED_TO_ASSET', assignedAssetId: asset.id } });

      const allocated = await this.numbering.allocateNumber(tenantId, FIXED_ASSET_CAPITALIZATION_TYPE, documentDate, tx);
      const doc = await tx.fixedAssetCapitalization.create({
        data: {
          tenantId,
          organizationId,
          cipProjectId: dto.cipProjectId,
          assetId: asset.id,
          currencyId: dto.currencyId,
          amount: amount.toString(),
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_CREATED', entityType: 'FIXED_ASSET', entityId: asset.id, action: 'CREATE', userId, newValues: { name: dto.name, amount: amount.toString() } }, tx);
      return { asset, capitalization: doc };
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetCapitalization.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAssetCapitalization.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('FixedAssetCapitalization', id);
    return row;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }

  private async ensureSequences(tenantId: string) {
    for (const [code, prefix] of [[FIXED_ASSET_CAPITALIZATION_TYPE, SEQUENCE_PREFIX], ['FIXED_ASSET', ASSET_SEQUENCE_PREFIX]] as const) {
      const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code } } });
      if (existing) continue;
      try {
        await this.prisma.numberSequence.create({ data: { tenantId, code, documentType: code, prefix, padding: 6, resetPolicy: 'YEARLY' } });
      } catch {
        // Lost the race — fine.
      }
    }
  }
}
