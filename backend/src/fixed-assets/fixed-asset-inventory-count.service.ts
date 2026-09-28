import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  StartInventoryCountDto,
  SubmitInventoryCountDto,
} from './dto/fixed-asset.dto';

const ENTITY_TYPE = 'FixedAssetInventoryCount';

/**
 * FixedAssetInventoryCount (docx spec Phase 16 sections 59-64) — mirrors
 * CashPhysicalCount's own session pattern (Phase 15). WRONG_LOCATION/
 * WRONG_RESPONSIBLE_PERSON auto-create a FixedAssetTransfer correction on
 * `submitResults` (spec section 62: "Create transfer correction instead
 * of write-off") since that carries no financial consequence. MISSING/
 * DAMAGED/UNREGISTERED_ASSET are deliberately NOT auto-resolved (spec
 * sections 63-64: "Do not automatically write off" / "Automatic asset
 * card creation qadağandır") — they stay OPEN until a human creates the
 * follow-up Disposal or FixedAsset document explicitly.
 */
@Injectable()
export class FixedAssetInventoryCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.fixedAssetInventoryCount.findMany({
          where: { organizationId },
          orderBy: { countDate: 'desc' },
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
    const row = await this.prisma.fixedAssetInventoryCount.findFirst({
      where: { id, organizationId },
      include: { results: true },
    });
    if (!row) throw new NotFoundAppError(ENTITY_TYPE, id);
    return row;
  }

  async start(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: StartInventoryCountDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const created = await this.prisma.fixedAssetInventoryCount.create({
      data: {
        tenantId,
        organizationId,
        scopeDepartmentId: dto.scopeDepartmentId,
        scopeWarehouseId: dto.scopeWarehouseId,
        scopeCategoryId: dto.scopeCategoryId,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'FIXED_ASSET_INVENTORY_STARTED',
      entityType: ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
    });
    return created;
  }

  async submitResults(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: SubmitInventoryCountDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const count = await this.prisma.fixedAssetInventoryCount.findFirst({
      where: { id, organizationId },
    });
    if (!count) throw new NotFoundAppError(ENTITY_TYPE, id);
    if (count.status !== 'DRAFT')
      throw new ValidationAppError(
        'Only a DRAFT inventory count can have results submitted',
      );
    if (count.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      await tx.fixedAssetInventoryResult.deleteMany({ where: { countId: id } });

      for (const line of dto.results) {
        let expectedLocationWarehouseId: string | null = null;
        let expectedResponsiblePersonId: string | null = null;
        if (line.assetId) {
          const asset = await tx.fixedAsset.findFirst({
            where: { id: line.assetId, organizationId },
          });
          if (!asset)
            throw new ValidationAppError(
              `Asset ${line.assetId} does not belong to this organization`,
            );
          expectedLocationWarehouseId = asset.locationWarehouseId;
          expectedResponsiblePersonId = asset.responsiblePersonId;
        } else if (line.resultType !== 'UNREGISTERED_ASSET') {
          throw new ValidationAppError(
            `resultType ${line.resultType} requires an assetId`,
          );
        }

        const isCorrection =
          line.assetId &&
          (line.resultType === 'WRONG_LOCATION' ||
            line.resultType === 'WRONG_RESPONSIBLE_PERSON');
        let resolutionDocumentId: string | null = null;

        if (isCorrection) {
          const asset = await tx.fixedAsset.findFirst({
            where: { id: line.assetId! },
          });
          const transfer = await tx.fixedAssetTransfer.create({
            data: {
              tenantId,
              organizationId,
              assetId: line.assetId!,
              effectiveDate: count.countDate,
              fromDepartmentId: asset!.departmentId,
              toDepartmentId: asset!.departmentId,
              fromLocationWarehouseId: asset!.locationWarehouseId,
              toLocationWarehouseId:
                line.foundLocationWarehouseId ?? asset!.locationWarehouseId,
              fromResponsiblePersonId: asset!.responsiblePersonId,
              toResponsiblePersonId:
                line.foundResponsiblePersonId ?? asset!.responsiblePersonId,
              reason: `Physical inventory correction (count ${count.id})`,
              createdBy: userId,
            },
          });
          await tx.fixedAsset.update({
            where: { id: line.assetId! },
            data: {
              locationWarehouseId:
                line.foundLocationWarehouseId ?? asset!.locationWarehouseId,
              responsiblePersonId:
                line.foundResponsiblePersonId ?? asset!.responsiblePersonId,
            },
          });
          resolutionDocumentId = transfer.id;
        }

        await tx.fixedAssetInventoryResult.create({
          data: {
            tenantId,
            countId: id,
            assetId: line.assetId,
            resultType: line.resultType,
            expectedLocationWarehouseId,
            foundLocationWarehouseId: line.foundLocationWarehouseId,
            expectedResponsiblePersonId,
            foundResponsiblePersonId: line.foundResponsiblePersonId,
            condition: line.condition,
            notes: line.notes,
            resolutionStatus: isCorrection ? 'RESOLVED' : 'OPEN',
            resolutionDocumentType: isCorrection
              ? 'FIXED_ASSET_TRANSFER'
              : null,
            resolutionDocumentId,
          },
        });
      }

      const result = await tx.fixedAssetInventoryCount.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: {
          status: 'SUBMITTED',
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_INVENTORY_SUBMITTED',
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: { resultCount: dto.results.length },
        },
        tx,
      );
      return tx.fixedAssetInventoryCount.findFirst({
        where: { id },
        include: { results: true },
      });
    });
  }

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const count = await this.prisma.fixedAssetInventoryCount.findFirst({
      where: { id, organizationId },
    });
    if (!count) throw new NotFoundAppError(ENTITY_TYPE, id);
    if (count.status !== 'SUBMITTED')
      throw new ValidationAppError(
        'Only a SUBMITTED inventory count can be approved',
      );

    const result = await this.prisma.fixedAssetInventoryCount.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date(),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'FIXED_ASSET_INVENTORY_APPROVED',
      entityType: ENTITY_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.fixedAssetInventoryCount.findFirst({
      where: { id },
      include: { results: true },
    });
  }
}
