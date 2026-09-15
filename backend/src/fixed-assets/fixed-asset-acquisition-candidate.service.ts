import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * FixedAssetAcquisitionService (spec sections 4-7). A candidate NEVER
 * auto-creates an asset (spec section 5's own "Candidate avtomatik asset
 * yaratmamalıdır") — `classify` only records a capitalization DECISION;
 * the actual FixedAsset/CIP link is written by whichever flow consumes
 * that decision (`CapitalInvestmentProjectService.addCostLine` for
 * ASSIGNED_TO_CIP, `FixedAssetCapitalizationService.capitalizeDirect` for
 * ASSIGNED_TO_ASSET). Idempotent creation (spec section 129): a second
 * call for the same source document line is rejected outright rather than
 * creating a duplicate candidate.
 */
@Injectable()
export class FixedAssetAcquisitionCandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, status?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetAcquisitionCandidate.findMany({ where: { organizationId, status }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAssetAcquisitionCandidate.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('FixedAssetAcquisitionCandidate', id);
    return row;
  }

  /** Called by another module's posting handler (e.g. Purchase Invoice's
   * FIXED_ASSET line type) — never by direct user action, matching spec
   * section 4's own source list. */
  async createFromSource(
    tenantId: string,
    organizationId: string,
    userId: string,
    dto: { sourceDocumentType: string; sourceDocumentId: string; sourceDocumentLineId?: string; supplierId?: string; productId?: string; description?: string; quantity?: number; currencyId: string; transactionAmount: number; baseAmount: number; taxAmount?: number; candidateType: string; categoryId?: string },
  ) {
    const existing = await this.prisma.fixedAssetAcquisitionCandidate.findFirst({ where: { tenantId, sourceDocumentType: dto.sourceDocumentType, sourceDocumentId: dto.sourceDocumentId, sourceDocumentLineId: dto.sourceDocumentLineId } });
    if (existing) return existing; // idempotent — spec section 129

    const row = await this.prisma.fixedAssetAcquisitionCandidate.create({
      data: {
        tenantId,
        organizationId,
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        sourceDocumentLineId: dto.sourceDocumentLineId,
        supplierId: dto.supplierId,
        productId: dto.productId,
        description: dto.description,
        quantity: (dto.quantity ?? 1).toString(),
        currencyId: dto.currencyId,
        transactionAmount: dto.transactionAmount.toString(),
        baseAmount: dto.baseAmount.toString(),
        taxAmount: (dto.taxAmount ?? 0).toString(),
        candidateType: dto.candidateType,
        categoryId: dto.categoryId,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_CANDIDATE_CREATED', entityType: 'FIXED_ASSET_ACQUISITION_CANDIDATE', entityId: row.id, action: 'CREATE', userId, newValues: { sourceDocumentType: dto.sourceDocumentType, sourceDocumentId: dto.sourceDocumentId, amount: dto.transactionAmount } });
    return row;
  }

  /** Records the capitalization decision (spec section 6) — audited, does
   * not itself move money or create an asset. */
  async classify(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: { decision: 'CAPITALIZABLE' | 'EXPENSE' | 'ASSIGNED_TO_CIP' | 'ASSIGNED_TO_ASSET' | 'CANCELLED'; capitalizableAmount?: number; assignedCipProjectId?: string; assignedAssetId?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const candidate = await this.prisma.fixedAssetAcquisitionCandidate.findFirst({ where: { id, organizationId } });
    if (!candidate) throw new NotFoundAppError('FixedAssetAcquisitionCandidate', id);
    if (['CAPITALIZED', 'CANCELLED'].includes(candidate.status)) throw new ValidationAppError(`Candidate is already ${candidate.status} and cannot be reclassified`);
    if (dto.decision === 'ASSIGNED_TO_CIP' && !dto.assignedCipProjectId) throw new ValidationAppError('ASSIGNED_TO_CIP requires assignedCipProjectId');
    if (dto.decision === 'ASSIGNED_TO_ASSET' && !dto.assignedAssetId) throw new ValidationAppError('ASSIGNED_TO_ASSET requires assignedAssetId');

    const row = await this.prisma.fixedAssetAcquisitionCandidate.update({
      where: { id },
      data: {
        status: dto.decision,
        capitalizableAmount: (dto.capitalizableAmount ?? candidate.transactionAmount.toString()).toString(),
        assignedCipProjectId: dto.assignedCipProjectId,
        assignedAssetId: dto.assignedAssetId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_CANDIDATE_CLASSIFIED', entityType: 'FIXED_ASSET_ACQUISITION_CANDIDATE', entityId: id, action: 'UPDATE', userId, oldValues: { status: candidate.status }, newValues: { status: dto.decision } });
    return row;
  }
}
