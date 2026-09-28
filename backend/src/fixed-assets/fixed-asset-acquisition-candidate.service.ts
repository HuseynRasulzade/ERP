import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import {
  AccountingPostingEngine,
  AccountingPostingLineInput,
} from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  FixedAssetBalanceService,
  FIXED_ASSET_MOVEMENT_REGISTER,
} from './fixed-asset-balance.service';
import {
  ClassifyAcquisitionCandidateDto,
  CreateAcquisitionCandidateDto,
} from './dto/fixed-asset.dto';

const ACQUISITION_CANDIDATE_TYPE = 'FIXED_ASSET_ACQUISITION_CANDIDATE';
const FIXED_ASSET_TYPE = 'FIXED_ASSET';
const ASSET_SEQUENCE_PREFIX = 'FA';

/**
 * FixedAssetAcquisitionCandidate (docx spec Phase 16 section 4-6) — a
 * candidate is created purely for traceability (never automatically spun
 * up by Purchase Invoice posting — spec section 167) and is NEVER
 * auto-converted into an asset. `classify()` is the one human decision
 * point (CAPITALIZE / EXPENSE / ASSIGN_TO_CIP / ASSIGN_TO_ASSET).
 *
 * Disclosed simplification (docs/FIXED_ASSETS.md): this build does not
 * extend Phase 9's PurchaseInvoicePostingHandler with a FIXED_ASSET line
 * type that would post straight to CIP/FA-clearing instead of a normal
 * expense/inventory account (a stable, heavily-tested surface this build
 * does not touch). Consequently CAPITALIZE/ASSIGN_TO_CIP post their own
 * self-contained GL event (Dr CIP-or-Fixed-Asset-Cost / Cr Supplier
 * Payable when a supplier is set, else a neutral Other-Operating-Income
 * wash) rather than reclassifying an already-posted Purchase Invoice
 * line — a real source document's own payable and this event's own
 * contra both exist and must be reconciled manually until that Phase 9
 * extension lands.
 */
@Injectable()
export class FixedAssetAcquisitionCandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly accountingEngine: AccountingPostingEngine,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    status?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.fixedAssetAcquisitionCandidate.findMany({
          where: { organizationId, ...(status ? { status } : {}) },
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
    const row = await this.prisma.fixedAssetAcquisitionCandidate.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('FixedAssetAcquisitionCandidate', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateAcquisitionCandidateDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const transactionAmount = new Decimal(dto.transactionAmount.toString());
    if (!transactionAmount.isFinite() || transactionAmount.lte(0))
      throw new ValidationAppError('transactionAmount must be positive');

    const created = await this.prisma.fixedAssetAcquisitionCandidate.create({
      data: {
        tenantId,
        organizationId,
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        sourceDocumentLineId: dto.sourceDocumentLineId,
        supplierId: dto.supplierId,
        productId: dto.productId,
        description: dto.description,
        quantity: new Decimal(dto.quantity?.toString() ?? '1'),
        currencyId: dto.currencyId,
        transactionAmount,
        baseAmount: new Decimal(
          (dto.baseAmount ?? dto.transactionAmount).toString(),
        ),
        taxAmount: new Decimal(dto.taxAmount?.toString() ?? '0'),
        candidateType: dto.candidateType ?? 'PURCHASE',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'FIXED_ASSET_CANDIDATE_CREATED',
      entityType: ACQUISITION_CANDIDATE_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: {
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        transactionAmount: transactionAmount.toString(),
      },
    });
    return created;
  }

  async classify(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ClassifyAcquisitionCandidateDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const candidate = await this.get(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
    if (candidate.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();
    if (candidate.status !== 'NEW' && candidate.status !== 'UNDER_REVIEW') {
      throw new ValidationAppError(
        `Cannot classify a candidate already in status ${candidate.status}`,
      );
    }

    const capitalizableAmount = new Decimal(
      (
        dto.capitalizableAmount ?? candidate.transactionAmount.toString()
      ).toString(),
    );
    const businessDate = dto.effectiveDate
      ? new Date(dto.effectiveDate)
      : new Date();

    if (dto.decision === 'EXPENSE') {
      return this.finalize(
        tenantId,
        id,
        dto.expectedVersion,
        { status: 'EXPENSE', capitalizableAmount: new Decimal(0) },
        userId,
        'FIXED_ASSET_CANDIDATE_EXPENSED',
      );
    }

    if (dto.decision === 'ASSIGN_TO_CIP') {
      if (!dto.cipProjectId)
        throw new ValidationAppError('ASSIGN_TO_CIP requires a cipProjectId');
      const project = await this.prisma.capitalInvestmentProject.findFirst({
        where: { id: dto.cipProjectId, organizationId },
      });
      if (!project)
        throw new ValidationAppError(
          'CIP project does not belong to this organization',
        );
      if (project.status === 'CAPITALIZED' || project.status === 'CANCELLED')
        throw new ValidationAppError(
          `Cannot add cost to a ${project.status} CIP project`,
        );

      return this.prisma.runInTransaction(async (tx) => {
        await tx.capitalInvestmentCost.create({
          data: {
            tenantId,
            projectId: dto.cipProjectId!,
            costComponent: dto.costComponent ?? 'OTHER',
            amount: capitalizableAmount,
            sourceDocumentType: candidate.sourceDocumentType,
            sourceDocumentId: candidate.sourceDocumentId,
            candidateId: candidate.id,
            effectiveDate: businessDate,
            description: candidate.description,
            createdBy: userId,
          },
        });
        await this.recordCipMovement(
          tenantId,
          organizationId,
          dto.cipProjectId!,
          businessDate,
          capitalizableAmount,
          'CAPITALIZATION',
          tx,
        );

        await this.postAcquisitionEntry(
          tenantId,
          organizationId,
          userId,
          businessDate,
          capitalizableAmount,
          candidate.supplierId,
          {
            debitKey: MappingKeys.FIXED_ASSET_CIP,
            debitDimensions: [
              { dimensionCode: 'CIP_PROJECT', referenceId: dto.cipProjectId! },
            ],
            sourceDocumentId: `${candidate.id}:CIP`,
            description: `CIP cost — ${candidate.description ?? candidate.sourceDocumentId}`,
          },
          tx,
        );

        const result = await tx.fixedAssetAcquisitionCandidate.updateMany({
          where: { id, organizationId, version: dto.expectedVersion },
          data: {
            status: 'ASSIGNED_TO_CIP',
            assignedCipProjectId: dto.cipProjectId,
            capitalizableAmount,
            updatedBy: userId,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) throw new ConcurrencyConflictError();

        await this.audit.record(
          {
            tenantId,
            eventType: 'FIXED_ASSET_CANDIDATE_ASSIGNED_TO_CIP',
            entityType: ACQUISITION_CANDIDATE_TYPE,
            entityId: id,
            action: 'UPDATE',
            userId,
            newValues: {
              cipProjectId: dto.cipProjectId,
              amount: capitalizableAmount.toString(),
            },
          },
          tx,
        );
        return tx.fixedAssetAcquisitionCandidate.findFirst({ where: { id } });
      });
    }

    if (dto.decision === 'CAPITALIZE') {
      if (!dto.categoryId)
        throw new ValidationAppError('CAPITALIZE requires a categoryId');
      const category = await this.prisma.fixedAssetCategory.findFirst({
        where: { id: dto.categoryId, tenantId },
      });
      if (!category)
        throw new ValidationAppError('Category does not belong to this tenant');

      return this.prisma.runInTransaction(async (tx) => {
        const allocated = await this.ensureAssetSequenceAndAllocate(
          tenantId,
          businessDate,
          tx,
        );
        const asset = await tx.fixedAsset.create({
          data: {
            tenantId,
            organizationId,
            assetNumber: allocated,
            name: dto.name ?? candidate.description ?? 'Fixed Asset',
            categoryId: dto.categoryId,
            acquisitionDate: businessDate,
            initialCost: capitalizableAmount,
            currencyId: candidate.currencyId,
            usefulLifeMonths: category.defaultUsefulLifeMonths ?? undefined,
            depreciationMethod: category.defaultDepreciationMethod,
            residualValue: category.defaultResidualValue,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        await this.recordCostMovement(
          tenantId,
          organizationId,
          asset.id,
          businessDate,
          capitalizableAmount,
          'INITIAL_RECOGNITION',
          FIXED_ASSET_TYPE,
          asset.id,
          tx,
        );
        await this.postAcquisitionEntry(
          tenantId,
          organizationId,
          userId,
          businessDate,
          capitalizableAmount,
          candidate.supplierId,
          {
            debitKey: MappingKeys.FIXED_ASSET_COST,
            debitDimensions: [
              { dimensionCode: 'FIXED_ASSET', referenceId: asset.id },
            ],
            sourceDocumentId: `${candidate.id}:CAPITALIZE`,
            description: `Direct capitalization — ${asset.name}`,
          },
          tx,
        );

        const result = await tx.fixedAssetAcquisitionCandidate.updateMany({
          where: { id, organizationId, version: dto.expectedVersion },
          data: {
            status: 'CAPITALIZED',
            assignedAssetId: asset.id,
            capitalizableAmount,
            updatedBy: userId,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) throw new ConcurrencyConflictError();

        await this.audit.record(
          {
            tenantId,
            eventType: 'FIXED_ASSET_CANDIDATE_CAPITALIZED',
            entityType: ACQUISITION_CANDIDATE_TYPE,
            entityId: id,
            action: 'UPDATE',
            userId,
            newValues: {
              assetId: asset.id,
              amount: capitalizableAmount.toString(),
            },
          },
          tx,
        );
        return {
          candidate: await tx.fixedAssetAcquisitionCandidate.findFirst({
            where: { id },
          }),
          asset,
        };
      });
    }

    if (dto.decision === 'ASSIGN_TO_ASSET') {
      if (!dto.assetId)
        throw new ValidationAppError('ASSIGN_TO_ASSET requires an assetId');
      const asset = await this.prisma.fixedAsset.findFirst({
        where: { id: dto.assetId, organizationId },
      });
      if (!asset)
        throw new ValidationAppError(
          'Asset does not belong to this organization',
        );

      return this.prisma.runInTransaction(async (tx) => {
        await this.recordCostMovement(
          tenantId,
          organizationId,
          asset.id,
          businessDate,
          capitalizableAmount,
          'CAPITALIZATION',
          FIXED_ASSET_TYPE,
          asset.id,
          tx,
        );
        await this.postAcquisitionEntry(
          tenantId,
          organizationId,
          userId,
          businessDate,
          capitalizableAmount,
          candidate.supplierId,
          {
            debitKey: MappingKeys.FIXED_ASSET_COST,
            debitDimensions: [
              { dimensionCode: 'FIXED_ASSET', referenceId: asset.id },
            ],
            sourceDocumentId: `${candidate.id}:ASSIGN`,
            description: `Additional cost assigned — ${asset.name}`,
          },
          tx,
        );

        const result = await tx.fixedAssetAcquisitionCandidate.updateMany({
          where: { id, organizationId, version: dto.expectedVersion },
          data: {
            status: 'ASSIGNED_TO_ASSET',
            assignedAssetId: asset.id,
            capitalizableAmount,
            updatedBy: userId,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) throw new ConcurrencyConflictError();

        await this.audit.record(
          {
            tenantId,
            eventType: 'FIXED_ASSET_CANDIDATE_ASSIGNED_TO_ASSET',
            entityType: ACQUISITION_CANDIDATE_TYPE,
            entityId: id,
            action: 'UPDATE',
            userId,
            newValues: {
              assetId: asset.id,
              amount: capitalizableAmount.toString(),
            },
          },
          tx,
        );
        return tx.fixedAssetAcquisitionCandidate.findFirst({ where: { id } });
      });
    }

    throw new ValidationAppError(
      `Unknown classification decision ${dto.decision}`,
    );
  }

  private async finalize(
    tenantId: string,
    id: string,
    expectedVersion: number,
    data: { status: string; capitalizableAmount: Decimal },
    userId: string,
    eventType: string,
  ) {
    const result = await this.prisma.fixedAssetAcquisitionCandidate.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        status: data.status,
        capitalizableAmount: data.capitalizableAmount,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType,
      entityType: ACQUISITION_CANDIDATE_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.fixedAssetAcquisitionCandidate.findFirst({
      where: { id },
    });
  }

  /** Shared self-contained GL event for CIP/direct-capitalization/asset-
   * assignment — Dr [debitKey] / Cr Supplier Payable (or a neutral wash
   * when no supplier), keyed under this candidate's own sub-path so
   * repeated classification attempts of the SAME candidate never collide
   * (each decision path uses its own suffix). */
  private async postAcquisitionEntry(
    tenantId: string,
    organizationId: string,
    userId: string,
    businessDate: Date,
    amount: Decimal,
    supplierId: string | null,
    opts: {
      debitKey: string;
      debitDimensions: { dimensionCode: string; referenceId: string }[];
      sourceDocumentId: string;
      description: string;
    },
    tx: PrismaTransactionClient,
  ) {
    const debitAccount = await this.mappings.resolve(
      tenantId,
      organizationId,
      opts.debitKey,
      businessDate,
      tx,
    );
    let currencyId: string | null = null;
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
    });
    currencyId = org?.baseCurrencyId ?? null;
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }

    let lines: AccountingPostingLineInput[];
    if (supplierId) {
      const payableAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.SUPPLIER_PAYABLE,
        businessDate,
        tx,
      );
      const payableDims = [
        { dimensionCode: 'PARTNER', referenceId: supplierId },
        { dimensionCode: 'COUNTERPARTY', referenceId: supplierId },
        ...(currencyId
          ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }]
          : []),
      ];
      lines = [
        {
          accountId: debitAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: opts.description,
          dimensions: opts.debitDimensions,
        },
        {
          accountId: payableAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: opts.description,
          dimensions: payableDims,
        },
      ];
    } else {
      const washAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.OTHER_OPERATING_INCOME,
        businessDate,
        tx,
      );
      lines = [
        {
          accountId: debitAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: opts.description,
          dimensions: opts.debitDimensions,
        },
        {
          accountId: washAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: opts.description,
          dimensions: [],
        },
      ];
    }

    return this.accountingEngine.postBatch(
      tenantId,
      userId,
      {
        organizationId,
        businessDate,
        postingDate: businessDate,
        description: opts.description,
        operationType: 'SYSTEM_DOCUMENT',
        sourceDocumentType: ACQUISITION_CANDIDATE_TYPE,
        sourceDocumentId: opts.sourceDocumentId,
        lines,
      },
      tx,
    );
  }

  private async recordCostMovement(
    tenantId: string,
    organizationId: string,
    assetId: string,
    businessDate: Date,
    amount: Decimal,
    movementType: string,
    recorderDocumentType: string,
    recorderDocumentId: string,
    tx: PrismaTransactionClient,
  ) {
    const sequence = await this.balances.nextSequence(
      tenantId,
      recorderDocumentType,
      recorderDocumentId,
      tx,
    );
    await tx.registerMovement.create({
      data: {
        tenantId,
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        recorderDocumentType,
        recorderDocumentId,
        businessDate,
        movementType,
        dimensions: { organizationId, assetId },
        resources: { costIncrease: amount.toString() },
        sequence,
      },
    });
  }

  private async recordCipMovement(
    tenantId: string,
    organizationId: string,
    cipProjectId: string,
    businessDate: Date,
    amount: Decimal,
    movementType: string,
    tx: PrismaTransactionClient,
  ) {
    const recorderDocumentType = 'CAPITAL_INVESTMENT_PROJECT';
    const sequence = await this.balances.nextSequence(
      tenantId,
      recorderDocumentType,
      cipProjectId,
      tx,
    );
    await tx.registerMovement.create({
      data: {
        tenantId,
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        recorderDocumentType,
        recorderDocumentId: cipProjectId,
        businessDate,
        movementType,
        dimensions: { organizationId, cipProjectId },
        resources: { costIncrease: amount.toString() },
        sequence,
      },
    });
  }

  private async ensureAssetSequenceAndAllocate(
    tenantId: string,
    businessDate: Date,
    tx: PrismaTransactionClient,
  ): Promise<string> {
    let sequence = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: FIXED_ASSET_TYPE } },
    });
    if (!sequence) {
      try {
        sequence = await this.prisma.numberSequence.create({
          data: {
            tenantId,
            code: FIXED_ASSET_TYPE,
            documentType: FIXED_ASSET_TYPE,
            prefix: ASSET_SEQUENCE_PREFIX,
            padding: 6,
            resetPolicy: 'NEVER',
          },
        });
      } catch {
        // Lost the race — fine.
      }
    }
    const allocated = await this.numbering.allocateNumber(
      tenantId,
      FIXED_ASSET_TYPE,
      businessDate,
      tx,
    );
    return allocated.formatted;
  }
}
