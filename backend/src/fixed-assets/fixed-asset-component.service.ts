import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { DisposalType, FaDocumentType } from './fixed-assets.constants';
import { FixedAssetDisposalService } from './fixed-asset-disposal.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';

/**
 * FixedAssetComponentService (spec sections 38-40, 155-156). A component is
 * a child FixedAsset (parentAssetId, componentType, componentSequence) with
 * its OWN cost, useful life, method and schedule. Replacement derecognizes
 * the old component through a COMPONENT_REPLACEMENT disposal (its NBV goes
 * to disposal loss) — the old cost is never simply added onto the parent —
 * while the new component is capitalized through the normal candidate /
 * CIP -> acceptance -> commissioning flow. The parent's lifecycle and
 * history continue untouched.
 */
@Injectable()
export class FixedAssetComponentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly disposal: FixedAssetDisposalService,
    private readonly documents: FixedAssetDocumentService,
    private readonly ledger: FixedAssetLedgerService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, parentAssetId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const parent = await this.prisma.fixedAsset.findFirst({ where: { id: parentAssetId, tenantId, organizationId } });
    if (!parent) throw new NotFoundAppError('FixedAsset', parentAssetId);
    const components = await this.prisma.fixedAsset.findMany({ where: { tenantId, parentAssetId }, orderBy: [{ componentSequence: 'asc' }, { assetNumber: 'asc' }] });
    const withBalances = [];
    for (const c of components) {
      const b = await this.ledger.balances(tenantId, c.id);
      withBalances.push({ ...c, cost: b.cost.toString(), accumulatedDepreciation: b.accumulatedDepreciation.toString(), netBookValue: b.netBookValue.toString() });
    }
    return withBalances;
  }

  async replace(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    parentAssetId: string,
    userId: string,
    dto: { oldComponentId: string; date: string; reason: string; proceeds?: number; newComponentId?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const old = await this.prisma.fixedAsset.findFirst({ where: { id: dto.oldComponentId, tenantId, organizationId } });
    if (!old) throw new NotFoundAppError('FixedAsset', dto.oldComponentId);
    if (old.parentAssetId !== parentAssetId) throw new ValidationAppError(`Asset ${old.assetNumber} is not a component of the given parent`);
    if (dto.newComponentId) {
      const nc = await this.prisma.fixedAsset.findFirst({ where: { id: dto.newComponentId, tenantId, organizationId } });
      if (!nc || nc.parentAssetId !== parentAssetId) throw new ValidationAppError('The new component must be a child of the same parent asset');
    }
    await this.documents.prepare(tenantId, FaDocumentType.DISPOSAL);
    const disposal = await this.prisma.runInTransaction((tx) =>
      this.disposal.disposeInTx(tx, tenantId, organizationId, old.id, userId, {
        date: dto.date,
        disposalType: DisposalType.COMPONENT_REPLACEMENT,
        proceeds: dto.proceeds,
        reason: dto.reason,
      }),
    );
    return { parentAssetId, oldComponentId: old.id, newComponentId: dto.newComponentId ?? null, disposal };
  }
}
