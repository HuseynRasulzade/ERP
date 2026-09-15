import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FIXED_ASSET_IMPAIRMENT_TYPE } from './fixed-asset-impairment.repository';

const SEQUENCE_PREFIX = 'FAIMP';

@Injectable()
export class FixedAssetImpairmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** `recoverableAmount` drives the amount (spec section 53's own worked
   * example: carrying 100,000 - recoverable 80,000 = impairment 20,000);
   * `reversal: true` instead treats `recoverableAmount` as the amount to
   * reverse directly. */
  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { assetId: string; recoverableAmount: number; reason?: string; valuationSource?: string; reversal?: boolean; documentDate: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: dto.assetId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', dto.assetId);
    const carryingAmountBefore = new Decimal(asset.carryingAmount.toString());
    const impairmentAmount = dto.reversal ? new Decimal(dto.recoverableAmount) : carryingAmountBefore.minus(dto.recoverableAmount);
    if (impairmentAmount.lte(0)) throw new ValidationAppError(dto.reversal ? 'Reversal amount must be positive' : 'Recoverable amount must be less than the current carrying amount to record an impairment');
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, FIXED_ASSET_IMPAIRMENT_TYPE, documentDate, tx);
      const row = await tx.fixedAssetImpairment.create({
        data: {
          tenantId,
          organizationId,
          assetId: dto.assetId,
          carryingAmountBefore: carryingAmountBefore.toString(),
          recoverableAmount: dto.recoverableAmount.toString(),
          impairmentAmount: impairmentAmount.toString(),
          reason: dto.reason,
          valuationSource: dto.valuationSource,
          reversal: dto.reversal ?? false,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: dto.reversal ? 'FIXED_ASSET_IMPAIRMENT_REVERSAL_CREATED' : 'FIXED_ASSET_IMPAIRED', entityType: FIXED_ASSET_IMPAIRMENT_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { impairmentAmount: impairmentAmount.toString() } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, assetId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetImpairment.findMany({ where: { organizationId, assetId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: FIXED_ASSET_IMPAIRMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: FIXED_ASSET_IMPAIRMENT_TYPE, documentType: FIXED_ASSET_IMPAIRMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
