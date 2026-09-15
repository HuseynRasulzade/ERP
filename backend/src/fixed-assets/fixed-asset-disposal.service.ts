import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FIXED_ASSET_DISPOSAL_TYPE } from './fixed-asset-disposal.repository';

const SEQUENCE_PREFIX = 'FADISP';

@Injectable()
export class FixedAssetDisposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { assetId: string; disposalType: string; disposalShare?: number; proceeds?: number; buyerCounterpartyId?: string; salesInvoiceId?: string; disposalCosts?: number; currencyId: string; reason?: string; documentDate: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: dto.assetId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', dto.assetId);
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, FIXED_ASSET_DISPOSAL_TYPE, documentDate, tx);
      const row = await tx.fixedAssetDisposal.create({
        data: {
          tenantId,
          organizationId,
          assetId: dto.assetId,
          disposalType: dto.disposalType,
          disposalShare: (dto.disposalShare ?? 1).toString(),
          proceeds: dto.proceeds?.toString(),
          buyerCounterpartyId: dto.buyerCounterpartyId,
          salesInvoiceId: dto.salesInvoiceId,
          disposalCosts: (dto.disposalCosts ?? 0).toString(),
          currencyId: dto.currencyId,
          reason: dto.reason,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: dto.disposalType === 'WRITE_OFF' ? 'FIXED_ASSET_WRITE_OFF_CREATED' : 'FIXED_ASSET_DISPOSAL_CREATED', entityType: FIXED_ASSET_DISPOSAL_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { disposalType: dto.disposalType } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, assetId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetDisposal.findMany({ where: { organizationId, assetId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: FIXED_ASSET_DISPOSAL_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: FIXED_ASSET_DISPOSAL_TYPE, documentType: FIXED_ASSET_DISPOSAL_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
