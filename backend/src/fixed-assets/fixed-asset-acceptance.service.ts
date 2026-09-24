import { Injectable, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import {
  AssetStatus,
  Books,
  CandidateStatus,
  FaDocumentType,
  MovementType,
  dec,
  periodOf,
  toDate,
} from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { FixedAssetService } from './fixed-asset.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { validateAssignmentRefs } from './fixed-asset-references';
import { FixedAssetCostIncompleteError, FixedAssetInvalidStateError, NegativeNbvError } from './fixed-asset.errors';

export interface OpeningAssetInput {
  name: string;
  categoryId: string;
  inventoryNumber?: string;
  serialNumber?: string;
  originalCost: number;
  accumulatedDepreciation?: number;
  impairment?: number;
  revaluation?: number;
  usefulLifeMonths?: number;
  remainingUsefulLifeMonths?: number;
  residualValue?: number;
  depreciationMethod?: string;
  acquisitionDate?: string;
  commissioningDate?: string;
  departmentId?: string;
  locationId?: string;
  responsiblePersonId?: string;
  branchId?: string;
  expenseType?: string;
  quantity?: number;
}

/**
 * FixedAssetAcceptanceService (spec sections 17, 19, 76-77): legal /
 * accounting acceptance of an asset into the register — the moment the
 * formed initial cost is recognized (Dr FA_COST, Cr FA_CIP, movement
 * INITIAL_RECOGNITION). Acceptance NEVER starts depreciation; that only
 * becomes possible after the separate Commissioning document. Also hosts
 * opening-balance migration (FA_OPENING_BALANCE).
 */
@Injectable()
export class FixedAssetAcceptanceService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly documents: FixedAssetDocumentService,
    private readonly history: FixedAssetHistoryService,
    private readonly assets: FixedAssetService,
    private readonly policies: DepreciationPolicyService,
  ) {}

  onModuleInit() {
    this.documents.registerReversalHook(FaDocumentType.ACCEPTANCE, async (tx, doc) => {
      for (const line of doc.lines) {
        const comps = await tx.fixedAssetCostComponent.findMany({ where: { tenantId: doc.tenantId, assetId: line.assetId, purpose: 'INITIAL_COST', recognized: true, released: false } });
        await tx.fixedAssetCostComponent.updateMany({ where: { id: { in: comps.map((c) => c.id) } }, data: { recognized: false } });
        const candidateIds = comps.map((c) => c.candidateId).filter((x): x is string => !!x);
        if (candidateIds.length) await tx.fixedAssetAcquisitionCandidate.updateMany({ where: { id: { in: candidateIds } }, data: { status: CandidateStatus.ASSIGNED_TO_ASSET } });
        await tx.fixedAsset.update({ where: { id: line.assetId }, data: { acceptanceDate: null } });
      }
    });
  }

  async accept(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    assetId: string,
    userId: string,
    dto: { date: string; inventoryNumber?: string; departmentId?: string; locationId?: string; responsiblePersonId?: string; branchId?: string; description?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.documents.prepare(tenantId, FaDocumentType.ACCEPTANCE);
    await this.assets.prepareNumbering(tenantId);
    const date = toDate(dto.date);

    return this.prisma.runInTransaction(async (tx) => {
      const asset = await this.ledger.lockAsset(tx, tenantId, assetId);
      if (asset.organizationId !== organizationId) throw new FixedAssetInvalidStateError('Asset belongs to another organization');
      if (asset.status !== AssetStatus.ACQUISITION) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; only an asset in ACQUISITION can be accepted.`);
      const comps = await tx.fixedAssetCostComponent.findMany({ where: { tenantId, assetId, purpose: 'INITIAL_COST', recognized: false, released: false } });
      const cost = comps.reduce((s, c) => s.plus(dec(c.amount)), new Decimal(0));
      if (cost.lte(0)) throw new FixedAssetCostIncompleteError(asset.assetNumber, 'accepted');
      await validateAssignmentRefs(tx, tenantId, organizationId, dto);

      let inventoryNumber = dto.inventoryNumber ?? asset.inventoryNumber;
      if (dto.inventoryNumber && dto.inventoryNumber !== asset.inventoryNumber) await this.assets.assertInventoryNumberFree(tx, tenantId, organizationId, dto.inventoryNumber, asset.id);
      if (!inventoryNumber) inventoryNumber = await this.documents.allocate(tx, tenantId, 'FIXED_ASSET_INVENTORY_NUMBER', date);

      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.ACCEPTANCE,
        documentDate: date,
        userId,
        description: dto.description ?? `Acceptance of ${asset.assetNumber} ${asset.name}`,
        cipProjectId: asset.cipProjectId,
        lines: [
          {
            assetId,
            amount: cost.toString(),
            costBefore: '0',
            carryingAmountAfter: cost.toString(),
            statusBefore: asset.status,
            statusAfter: AssetStatus.ACCEPTED,
            toDepartmentId: dto.departmentId,
            toLocationId: dto.locationId,
            toResponsiblePersonId: dto.responsiblePersonId,
            toBranchId: dto.branchId,
            details: { components: comps.map((c) => ({ id: c.id, costComponent: c.costComponent, amount: c.amount.toString(), candidateId: c.candidateId, cipProjectId: c.cipProjectId })) },
          },
        ],
      });

      const profile = asset.category.accountingMappingProfile;
      const faCost = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_COST, date, profile, tx);
      const cip = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_CIP, date, profile, tx);
      const je = await this.accounting.post(
        tenantId,
        userId,
        {
          organizationId,
          businessDate: date,
          description: `Fixed asset acceptance ${doc.number} — ${asset.assetNumber}`,
          sourceDocumentType: FaDocumentType.ACCEPTANCE,
          sourceDocumentId: doc.id,
          lines: [
            this.accounting.line(faCost.id, 'DEBIT', cost, `Initial recognition ${asset.assetNumber}`, { assetId }),
            this.accounting.line(cip.id, 'CREDIT', cost, `CIP / acquisition clearing ${asset.assetNumber}`, { assetId }),
          ],
        },
        tx,
      );
      await this.documents.attachJournal(tx, doc.id, je?.id);

      await this.ledger.write(tx, {
        tenantId,
        organizationId,
        assetId,
        movementType: MovementType.INITIAL_RECOGNITION,
        businessDate: date,
        costIncrease: cost,
        quantityChange: asset.quantity,
        departmentId: dto.departmentId ?? asset.departmentId,
        locationId: dto.locationId ?? asset.locationId,
        sourceDocumentType: FaDocumentType.ACCEPTANCE,
        sourceDocumentId: doc.id,
        sourceDocumentLineId: doc.lines[0].id,
        journalEntryId: je?.id,
        description: 'Initial recognition',
        createdBy: userId,
      });

      await tx.fixedAssetCostComponent.updateMany({ where: { id: { in: comps.map((c) => c.id) } }, data: { recognized: true } });
      const candidateIds = comps.map((c) => c.candidateId).filter((x): x is string => !!x);
      if (candidateIds.length) await tx.fixedAssetAcquisitionCandidate.updateMany({ where: { id: { in: candidateIds } }, data: { status: CandidateStatus.CAPITALIZED, version: { increment: 1 } } });

      await tx.fixedAsset.update({ where: { id: assetId }, data: { status: AssetStatus.ACCEPTED, acceptanceDate: date, inventoryNumber, updatedBy: userId } });
      await this.history.recordParameter(tx, { tenantId, assetId, parameterCode: 'status', oldValue: asset.status, newValue: AssetStatus.ACCEPTED, effectiveDate: date, sourceDocumentType: FaDocumentType.ACCEPTANCE, sourceDocumentId: doc.id, createdBy: userId });
      if (dto.departmentId || dto.locationId || dto.responsiblePersonId || dto.branchId) {
        await this.history.assign(tx, { tenantId, assetId, validFrom: date, values: { departmentId: dto.departmentId, locationId: dto.locationId, responsiblePersonId: dto.responsiblePersonId, branchId: dto.branchId }, sourceDocumentType: FaDocumentType.ACCEPTANCE, sourceDocumentId: doc.id, createdBy: userId });
      }
      await this.ledger.refreshProjection(tx, tenantId, assetId);
      await this.audit.record(
        { tenantId, eventType: 'FixedAssetAccepted', entityType: 'FixedAsset', entityId: assetId, action: 'ACCEPT', userId, oldValues: { status: asset.status }, newValues: { status: AssetStatus.ACCEPTED, cost: cost.toString(), documentId: doc.id, journalEntryId: je?.id } },
        tx,
      );
      return { ...doc, journalEntryId: je?.id ?? null };
    });
  }

  /**
   * Opening balances / migration (spec sections 76-77): one document, one
   * card per asset, an OPENING_BALANCE register movement carrying gross
   * cost, accumulated depreciation, impairment and revaluation, and (unless
   * postToGl=false because GL opening balances are loaded separately) an
   * opening-balance Journal Entry against FA_OPENING_BALANCE_OFFSET.
   */
  async openingBalances(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { date: string; postToGl?: boolean; description?: string; assets: OpeningAssetInput[] },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    if (!dto.assets?.length) throw new ValidationAppError('At least one asset is required');
    await this.documents.prepare(tenantId, FaDocumentType.OPENING_BALANCE);
    await this.assets.prepareNumbering(tenantId);
    const date = toDate(dto.date);
    const postToGl = dto.postToGl !== false;

    const prepared = await this.prisma.runInTransaction(async (tx) => {
      const lines = [];
      const created = [];
      for (const a of dto.assets) {
        const cost = dec(a.originalCost);
        const acc = dec(a.accumulatedDepreciation);
        const imp = dec(a.impairment);
        const reval = dec(a.revaluation);
        if (cost.lte(0)) throw new ValidationAppError(`Opening cost of ${a.name} must be positive`);
        if (acc.lt(0) || imp.lt(0)) throw new ValidationAppError(`Opening accumulated depreciation / impairment of ${a.name} cannot be negative`);
        const nbv = cost.plus(reval).minus(acc).minus(imp);
        if (nbv.lt(0)) throw new NegativeNbvError(`Opening balance of ${a.name} would give a negative net book value (${nbv.toFixed(2)}).`);
        if (a.remainingUsefulLifeMonths !== undefined && a.usefulLifeMonths !== undefined && a.remainingUsefulLifeMonths > a.usefulLifeMonths) {
          throw new ValidationAppError(`Remaining useful life of ${a.name} exceeds its total useful life`);
        }
        await validateAssignmentRefs(tx, tenantId, organizationId, a);
        const asset = await this.assets.createCard(tx, {
          tenantId,
          organizationId,
          categoryId: a.categoryId,
          name: a.name,
          inventoryNumber: a.inventoryNumber,
          serialNumber: a.serialNumber,
          quantity: a.quantity ?? 1,
          acquisitionDate: a.acquisitionDate ? toDate(a.acquisitionDate) : date,
          acquisitionSourceType: 'OPENING_BALANCE',
          createdBy: userId,
        });
        created.push({ asset, input: a, cost, acc, imp, reval, nbv });
        lines.push({
          assetId: asset.id,
          amount: cost.toString(),
          costBefore: '0',
          accumulatedDepreciationBefore: acc.toString(),
          impairmentBefore: imp.toString(),
          revaluationBefore: reval.toString(),
          carryingAmountAfter: nbv.toString(),
          usefulLifeAfter: a.usefulLifeMonths ?? null,
          remainingLifeAfter: a.remainingUsefulLifeMonths ?? a.usefulLifeMonths ?? null,
          residualAfter: a.residualValue !== undefined ? String(a.residualValue) : null,
          methodAfter: a.depreciationMethod ?? null,
          statusBefore: AssetStatus.ACQUISITION,
          statusAfter: a.commissioningDate ? AssetStatus.ACTIVE : AssetStatus.ACCEPTED,
          toDepartmentId: a.departmentId,
          toLocationId: a.locationId,
          toResponsiblePersonId: a.responsiblePersonId,
          toBranchId: a.branchId,
        });
      }

      const doc = await this.documents.create(tx, {
        tenantId,
        organizationId,
        documentType: FaDocumentType.OPENING_BALANCE,
        documentDate: date,
        userId,
        description: dto.description ?? 'Fixed asset opening balances',
        payload: { postToGl },
        lines,
      });

      let je = null;
      if (postToGl) {
        const jeLines = [];
        const offset = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_OPENING_BALANCE_OFFSET, date, null, tx);
        for (const c of created) {
          const profile = (await tx.fixedAssetCategory.findUniqueOrThrow({ where: { id: c.asset.categoryId } })).accountingMappingProfile;
          const faCost = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_COST, date, profile, tx);
          const accDep = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_ACCUMULATED_DEPRECIATION, date, profile, tx);
          const accImp = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_ACCUMULATED_IMPAIRMENT, date, profile, tx);
          jeLines.push(this.accounting.line(faCost.id, 'DEBIT', c.cost.plus(c.reval), `Opening gross cost ${c.asset.assetNumber}`, { assetId: c.asset.id }));
          jeLines.push(this.accounting.line(accDep.id, 'CREDIT', c.acc, `Opening accumulated depreciation ${c.asset.assetNumber}`, { assetId: c.asset.id }));
          jeLines.push(this.accounting.line(accImp.id, 'CREDIT', c.imp, `Opening impairment ${c.asset.assetNumber}`, { assetId: c.asset.id }));
          jeLines.push(this.accounting.line(offset.id, 'CREDIT', c.nbv, `Opening balance offset ${c.asset.assetNumber}`));
        }
        je = await this.accounting.post(
          tenantId,
          userId,
          { organizationId, businessDate: date, description: `Fixed asset opening balances ${doc.number}`, isOpeningBalance: true, operationType: 'OPENING_BALANCE', sourceDocumentType: FaDocumentType.OPENING_BALANCE, sourceDocumentId: doc.id, lines: jeLines },
          tx,
        );
        await this.documents.attachJournal(tx, doc.id, je?.id);
      }

      for (const [i, c] of created.entries()) {
        const a = c.input;
        await this.ledger.write(tx, {
          tenantId,
          organizationId,
          assetId: c.asset.id,
          movementType: MovementType.OPENING_BALANCE,
          businessDate: date,
          costIncrease: c.cost,
          depreciationIncrease: c.acc,
          impairmentIncrease: c.imp,
          revaluationIncrease: c.reval.gt(0) ? c.reval : 0,
          revaluationDecrease: c.reval.lt(0) ? c.reval.negated() : 0,
          quantityChange: a.quantity ?? 1,
          departmentId: a.departmentId,
          locationId: a.locationId,
          sourceDocumentType: FaDocumentType.OPENING_BALANCE,
          sourceDocumentId: doc.id,
          sourceDocumentLineId: doc.lines[i].id,
          journalEntryId: je?.id,
          description: 'Opening balance',
          createdBy: userId,
        });
        const category = await tx.fixedAssetCategory.findUniqueOrThrow({ where: { id: c.asset.categoryId } });
        const commissioningDate = a.commissioningDate ? toDate(a.commissioningDate) : null;
        const policy = await this.policies.resolvePolicy(tenantId, organizationId, category.id, date, Books.ACCOUNTING_BOOK, tx);
        let depreciationStartDate: Date | null = null;
        if (commissioningDate) {
          const computed = this.policies.depreciationStartDate(commissioningDate, category.defaultDepreciationStartRule ?? policy.depreciationStartRule);
          depreciationStartDate = computed.getTime() > date.getTime() ? computed : date;
          const usefulLife = a.usefulLifeMonths ?? category.defaultUsefulLifeMonths ?? null;
          await this.policies.createBookPolicy(tx, {
            tenantId,
            assetId: c.asset.id,
            effectiveDate: depreciationStartDate,
            usefulLifeMonths: usefulLife,
            remainingLifeMonths: a.remainingUsefulLifeMonths ?? usefulLife,
            residualValue: a.residualValue ?? category.defaultResidualValue,
            depreciationMethod: a.depreciationMethod ?? category.defaultDepreciationMethod,
            depreciationStartRule: category.defaultDepreciationStartRule ?? policy.depreciationStartRule,
            partialPeriodRule: category.defaultPartialPeriodRule ?? policy.partialPeriodRule,
            changeReason: 'Opening balance',
            sourceDocumentType: FaDocumentType.OPENING_BALANCE,
            sourceDocumentId: doc.id,
            createdBy: userId,
          });
        }
        await tx.fixedAsset.update({
          where: { id: c.asset.id },
          data: {
            status: commissioningDate ? AssetStatus.ACTIVE : AssetStatus.ACCEPTED,
            acceptanceDate: a.acquisitionDate ? toDate(a.acquisitionDate) : date,
            commissioningDate,
            depreciationStartDate,
            expenseType: a.expenseType ?? category.defaultExpenseType,
            inventoryNumber: c.asset.inventoryNumber ?? (await this.documents.allocate(tx, tenantId, 'FIXED_ASSET_INVENTORY_NUMBER', date)),
          },
        });
        await this.history.assign(tx, {
          tenantId,
          assetId: c.asset.id,
          validFrom: date,
          values: { departmentId: a.departmentId ?? null, locationId: a.locationId ?? null, responsiblePersonId: a.responsiblePersonId ?? null, branchId: a.branchId ?? null, expenseType: a.expenseType ?? category.defaultExpenseType },
          sourceDocumentType: FaDocumentType.OPENING_BALANCE,
          sourceDocumentId: doc.id,
          createdBy: userId,
        });
        await this.policies.reprojectParameters(tx, tenantId, c.asset.id);
        await this.ledger.refreshProjection(tx, tenantId, c.asset.id);
      }
      await this.audit.record(
        { tenantId, eventType: 'FIXED_ASSET_OPENING_BALANCE_POSTED', entityType: FaDocumentType.OPENING_BALANCE, entityId: doc.id, action: 'POST', userId, newValues: { assetCount: created.length, journalEntryId: je?.id ?? null, period: periodOf(date) } },
        tx,
      );
      return doc.id;
    });
    return this.documents.get(tenantId, organizationId, prepared);
  }
}
