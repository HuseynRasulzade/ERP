import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FIXED_ASSET_MODERNIZATION_TYPE } from './fixed-asset-modernization.repository';

const SEQUENCE_PREFIX = 'FAMOD';

/** FixedAssetModernizationService (spec sections 45-50). A repair-vs-
 * modernization decision is made by the CALLER choosing which document to
 * create (this one, vs. simply expensing a repair invoice elsewhere) —
 * this service itself only records the capital-improvement path (spec
 * section 48's own decision-support framing, not an automated classifier). */
@Injectable()
export class FixedAssetModernizationService {
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
    dto: { assetId: string; modernizationType?: string; sourceDocumentType?: string; sourceDocumentId?: string; currencyId: string; amount: number; newUsefulLifeMonths?: number; newResidualValue?: number; description?: string; documentDate: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: dto.assetId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', dto.assetId);
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, FIXED_ASSET_MODERNIZATION_TYPE, documentDate, tx);
      const row = await tx.fixedAssetModernization.create({
        data: {
          tenantId,
          organizationId,
          assetId: dto.assetId,
          modernizationType: dto.modernizationType ?? 'CAPITAL_IMPROVEMENT',
          sourceDocumentType: dto.sourceDocumentType,
          sourceDocumentId: dto.sourceDocumentId,
          currencyId: dto.currencyId,
          amount: dto.amount.toString(),
          newUsefulLifeMonths: dto.newUsefulLifeMonths,
          newResidualValue: dto.newResidualValue?.toString(),
          description: dto.description,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await tx.fixedAsset.update({ where: { id: dto.assetId }, data: { status: 'UNDER_MODERNIZATION' } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_MODERNIZATION_CREATED', entityType: FIXED_ASSET_MODERNIZATION_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { amount: dto.amount } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, assetId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetModernization.findMany({ where: { organizationId, assetId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: FIXED_ASSET_MODERNIZATION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: FIXED_ASSET_MODERNIZATION_TYPE, documentType: FIXED_ASSET_MODERNIZATION_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
