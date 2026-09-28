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
import { FIXED_ASSET_DISPOSAL_TYPE } from './fixed-asset-disposal.repository';
import { CreateDisposalDto } from './dto/fixed-asset.dto';

const SEQUENCE_PREFIX = 'FAD';

@Injectable()
export class FixedAssetDisposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.fixedAssetDisposal.findMany({
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
    const row = await this.prisma.fixedAssetDisposal.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('FixedAssetDisposal', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateDisposalDto,
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
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status))
      throw new ValidationAppError(`Asset is already ${asset.status}`);

    const proceeds =
      dto.proceeds !== undefined ? new Decimal(dto.proceeds.toString()) : null;
    if (proceeds && proceeds.gt(0) && !dto.buyerId)
      throw new ValidationAppError('Disposal proceeds require a buyerId');

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        FIXED_ASSET_DISPOSAL_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.fixedAssetDisposal.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          assetId: dto.assetId,
          disposalType: dto.disposalType,
          proceeds,
          buyerId: dto.buyerId,
          disposalCosts: new Decimal(dto.disposalCosts?.toString() ?? '0'),
          sourceSalesInvoiceId: dto.sourceSalesInvoiceId,
          reason: dto.reason,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_DISPOSAL_CREATED',
          entityType: FIXED_ASSET_DISPOSAL_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { assetId: dto.assetId, disposalType: dto.disposalType },
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
      where: { tenantId_code: { tenantId, code: FIXED_ASSET_DISPOSAL_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: FIXED_ASSET_DISPOSAL_TYPE,
          documentType: FIXED_ASSET_DISPOSAL_TYPE,
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
