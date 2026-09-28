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
import { FIXED_ASSET_MODERNIZATION_TYPE } from './fixed-asset-modernization.repository';
import { CreateModernizationDto } from './dto/fixed-asset.dto';

const SEQUENCE_PREFIX = 'FAM';

@Injectable()
export class FixedAssetModernizationService {
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
        this.prisma.fixedAssetModernization.findMany({
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
    const row = await this.prisma.fixedAssetModernization.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('FixedAssetModernization', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateModernizationDto,
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
    const amount = new Decimal(dto.amount.toString());
    if (!amount.isFinite() || amount.lte(0))
      throw new ValidationAppError('Amount must be positive');

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        FIXED_ASSET_MODERNIZATION_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.fixedAssetModernization.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          assetId: dto.assetId,
          amount,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_MODERNIZATION_CREATED',
          entityType: FIXED_ASSET_MODERNIZATION_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { assetId: dto.assetId, amount: amount.toString() },
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
      where: {
        tenantId_code: { tenantId, code: FIXED_ASSET_MODERNIZATION_TYPE },
      },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: FIXED_ASSET_MODERNIZATION_TYPE,
          documentType: FIXED_ASSET_MODERNIZATION_TYPE,
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
