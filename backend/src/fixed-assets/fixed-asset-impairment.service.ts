import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { FixedAssetBalanceService } from './fixed-asset-balance.service';
import { FIXED_ASSET_IMPAIRMENT_TYPE } from './fixed-asset-impairment.repository';
import { CreateImpairmentDto } from './dto/fixed-asset.dto';

const SEQUENCE_PREFIX = 'FAI';

@Injectable()
export class FixedAssetImpairmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.fixedAssetImpairment.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAssetImpairment.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('FixedAssetImpairment', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateImpairmentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id: dto.assetId, organizationId },
    });
    if (!asset)
      throw new ValidationAppError(
        'Asset does not belong to this organization',
      );

    const current = await this.balances.getBalances(
      tenantId,
      dto.assetId,
      businessDate,
    );
    const impairmentType = dto.impairmentType ?? 'IMPAIRMENT';
    const recoverableAmount = new Decimal(dto.recoverableAmount.toString());

    let impairmentAmount: Decimal;
    if (impairmentType === 'IMPAIRMENT') {
      impairmentAmount = current.netBookValue.minus(recoverableAmount);
      if (impairmentAmount.lte(0))
        throw new ValidationAppError(
          `Recoverable amount ${recoverableAmount.toFixed(2)} is not below the current carrying amount ${current.netBookValue.toFixed(2)} — nothing to impair`,
        );
    } else {
      impairmentAmount = recoverableAmount.minus(current.netBookValue);
      if (impairmentAmount.lte(0))
        throw new ValidationAppError(
          `Recoverable amount ${recoverableAmount.toFixed(2)} is not above the current carrying amount ${current.netBookValue.toFixed(2)} — nothing to reverse`,
        );
      if (impairmentAmount.gt(current.accumulatedImpairment))
        throw new ValidationAppError(
          `Reversal of ${impairmentAmount.toFixed(2)} would exceed accumulated impairment of ${current.accumulatedImpairment.toFixed(2)}`,
        );
    }

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        FIXED_ASSET_IMPAIRMENT_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.fixedAssetImpairment.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          assetId: dto.assetId,
          impairmentType,
          carryingAmountBefore: current.netBookValue,
          recoverableAmount,
          impairmentAmount,
          reason: dto.reason,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_IMPAIRMENT_CREATED',
          entityType: FIXED_ASSET_IMPAIRMENT_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: {
            assetId: dto.assetId,
            impairmentType,
            impairmentAmount: impairmentAmount.toString(),
          },
        },
        tx,
      );
      return created;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: FIXED_ASSET_IMPAIRMENT_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: FIXED_ASSET_IMPAIRMENT_TYPE,
          documentType: FIXED_ASSET_IMPAIRMENT_TYPE,
          prefix: SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race — fine.
    }
  }
}
