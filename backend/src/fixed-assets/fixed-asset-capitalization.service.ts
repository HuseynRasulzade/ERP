import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AssetStatus, CandidateStatus, CipStatus, FaSourceType, dec, formatAmount, toDate } from './fixed-assets.constants';
import { FixedAssetService } from './fixed-asset.service';
import { CapitalInvestmentService, allocateProportionally } from './capital-investment.service';
import { CandidateAlreadyProcessedError, CipBalanceExceededError, FixedAssetInvalidStateError } from './fixed-asset.errors';

export interface AssetSpec {
  name: string;
  categoryId: string;
  amount?: number;
  quantity?: number;
  description?: string;
  inventoryNumber?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  barcode?: string;
  parentAssetId?: string;
  componentType?: string;
  componentSequence?: number;
}

/** Splits `total` into `n` parts at 2dp; the last part absorbs rounding. */
function splitEvenly(total: Decimal, n: number): Decimal[] {
  const base = total.div(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const parts = Array.from({ length: n }, () => base);
  parts[n - 1] = total.minus(base.mul(n - 1));
  return parts;
}

/**
 * FixedAssetCapitalizationService (spec sections 11-14, 90, 130, 134):
 * forms asset cards and their initial-cost components from capitalizable
 * candidates or from a CIP project. Cards are created in ACQUISITION status;
 * the GL/subledger recognition (Dr FA_COST / Cr FA_CIP) happens only when
 * the Acceptance document is posted.
 */
@Injectable()
export class FixedAssetCapitalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly assets: FixedAssetService,
    private readonly cip: CapitalInvestmentService,
  ) {}

  /**
   * One or many candidates -> one or many assets (spec sections 12-14):
   *  - INDIVIDUAL_ASSET with count N: N cards, total cost split evenly
   *    ("10 laptops x 20,000 -> 10 cards of 2,000");
   *  - GROUP_ASSET: one card with quantity = count;
   *  - several candidates (equipment + freight + installation) -> the
   *    cost components of every resulting card reference every candidate.
   * Every candidate is locked and must still be CAPITALIZABLE, so a
   * concurrent second capitalization of the same candidate fails (s.163).
   */
  async createFromCandidates(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { candidateIds: string[]; mode?: 'INDIVIDUAL_ASSET' | 'GROUP_ASSET'; count?: number; asset: AssetSpec; acquisitionDate?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    if (!dto.candidateIds?.length) throw new ValidationAppError('At least one candidate is required');
    await this.assets.prepareNumbering(tenantId);
    const count = Math.max(1, dto.count ?? 1);
    const mode = dto.mode ?? 'INDIVIDUAL_ASSET';

    return this.prisma.runInTransaction(async (tx) => {
      const ids = [...new Set(dto.candidateIds)].sort();
      for (const cid of ids) await tx.$queryRaw`SELECT id FROM fixed_asset_acquisition_candidates WHERE id = ${cid} AND tenant_id = ${tenantId} FOR UPDATE`;
      const candidates = await tx.fixedAssetAcquisitionCandidate.findMany({ where: { id: { in: ids }, tenantId, organizationId } });
      if (candidates.length !== ids.length) throw new NotFoundAppError('FixedAssetAcquisitionCandidate');
      for (const c of candidates) {
        if (c.status !== CandidateStatus.CAPITALIZABLE) throw new CandidateAlreadyProcessedError(c.number ?? c.id, c.status);
        if (!c.glRecognized) throw new FixedAssetInvalidStateError(`Candidate ${c.number} has no GL recognition on the CIP account.`);
      }
      const acquisitionDate = dto.acquisitionDate ? toDate(dto.acquisitionDate) : candidates.map((c) => c.sourceDate).sort((a, b) => b.getTime() - a.getTime())[0];
      const cardCount = mode === 'GROUP_ASSET' ? 1 : count;

      const created = [];
      const perCandidateParts = candidates.map((c) => splitEvenly(dec(c.capitalizableAmount), cardCount));
      for (let i = 0; i < cardCount; i++) {
        const asset = await this.assets.createCard(tx, {
          tenantId,
          organizationId,
          categoryId: dto.asset.categoryId,
          name: cardCount > 1 ? `${dto.asset.name} #${i + 1}` : dto.asset.name,
          description: dto.asset.description,
          quantity: mode === 'GROUP_ASSET' ? count : 1,
          groupingType: mode,
          acquisitionDate,
          inventoryNumber: cardCount === 1 ? dto.asset.inventoryNumber : undefined,
          serialNumber: cardCount === 1 ? dto.asset.serialNumber : undefined,
          manufacturer: dto.asset.manufacturer,
          model: dto.asset.model,
          barcode: cardCount === 1 ? dto.asset.barcode : undefined,
          parentAssetId: dto.asset.parentAssetId,
          componentType: dto.asset.componentType,
          componentSequence: dto.asset.componentSequence,
          acquisitionSourceType: 'CANDIDATE',
          createdBy: userId,
        });
        for (const [ci, c] of candidates.entries()) {
          await tx.fixedAssetCostComponent.create({
            data: {
              tenantId,
              assetId: asset.id,
              costComponent: c.costComponent,
              amount: perCandidateParts[ci][i].toString(),
              candidateId: c.id,
              sourceDocumentType: c.sourceDocumentType,
              sourceDocumentId: c.sourceDocumentId,
              sourceDocumentLineId: c.sourceDocumentLineId,
              purpose: 'INITIAL_COST',
              description: c.description,
              createdBy: userId,
            },
          });
        }
        created.push(asset);
      }

      for (const c of candidates) {
        const res = await tx.fixedAssetAcquisitionCandidate.updateMany({
          where: { id: c.id, status: CandidateStatus.CAPITALIZABLE },
          data: { status: CandidateStatus.ASSIGNED_TO_ASSET, assignedAssetId: created[0].id, version: { increment: 1 } },
        });
        if (res.count !== 1) throw new CandidateAlreadyProcessedError(c.number ?? c.id, 'concurrently changed');
      }
      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_CAPITALIZATION_DECIDED',
          entityType: 'FixedAssetAcquisitionCandidate',
          entityId: candidates[0].id,
          action: 'CAPITALIZE',
          userId,
          newValues: { candidateIds: ids, assetIds: created.map((a) => a.id), mode, count },
        },
        tx,
      );
      return { assets: created.map((a) => this.assets.redact(a)) };
    });
  }

  /**
   * CIP -> asset(s) (spec sections 88, 90, 130): the project row is locked,
   * the requested total may never exceed the remaining CIP balance, and each
   * asset's amount is allocated across cost components proportionally so
   * the asset card keeps full component traceability.
   */
  async capitalizeCip(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    projectId: string,
    userId: string,
    dto: { date: string; assets: AssetSpec[]; closeProject?: boolean },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    if (!dto.assets?.length) throw new ValidationAppError('At least one asset is required');
    await this.assets.prepareNumbering(tenantId);
    const date = toDate(dto.date);

    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM capital_investment_projects WHERE id = ${projectId} AND tenant_id = ${tenantId} FOR UPDATE`;
      const project = await tx.capitalInvestmentProject.findFirst({ where: { id: projectId, tenantId, organizationId } });
      if (!project) throw new NotFoundAppError('CapitalInvestmentProject', projectId);
      if (project.status !== CipStatus.READY_FOR_CAPITALIZATION && project.status !== CipStatus.ACTIVE) {
        throw new FixedAssetInvalidStateError(`CIP project ${project.code} is ${project.status}; only an ACTIVE or READY_FOR_CAPITALIZATION project can be capitalized.`);
      }
      const byComponent = await this.cip.balanceByComponent(tenantId, projectId, tx);
      const remaining = [...byComponent.values()].reduce((s, v) => s.plus(v), new Decimal(0));
      const amounts = dto.assets.map((a) => (a.amount !== undefined ? dec(a.amount) : null));
      if (amounts.some((a) => a !== null && a.lte(0))) throw new ValidationAppError('Every asset amount must be positive');
      const unspecified = amounts.filter((a) => a === null).length;
      const specified = amounts.reduce<Decimal>((s, a) => (a ? s.plus(a) : s), new Decimal(0));
      if (specified.gt(remaining)) throw new CipBalanceExceededError(formatAmount(specified), formatAmount(remaining));
      if (unspecified > 0) {
        const rest = splitEvenly(remaining.minus(specified), unspecified);
        let k = 0;
        for (let i = 0; i < amounts.length; i++) if (amounts[i] === null) amounts[i] = rest[k++];
      }
      const total = amounts.reduce<Decimal>((s, a) => s.plus(a!), new Decimal(0));
      if (total.gt(remaining)) throw new CipBalanceExceededError(formatAmount(total), formatAmount(remaining));
      if (total.lte(0)) throw new FixedAssetInvalidStateError(`CIP project ${project.code} has no capitalizable balance.`);

      const working = new Map(byComponent);
      const created = [];
      for (const [i, spec] of dto.assets.entries()) {
        const amount = amounts[i]!;
        const asset = await this.assets.createCard(tx, {
          tenantId,
          organizationId,
          categoryId: spec.categoryId,
          name: spec.name,
          description: spec.description,
          quantity: spec.quantity ?? 1,
          acquisitionDate: date,
          inventoryNumber: spec.inventoryNumber,
          serialNumber: spec.serialNumber,
          manufacturer: spec.manufacturer,
          model: spec.model,
          barcode: spec.barcode,
          parentAssetId: spec.parentAssetId,
          componentType: spec.componentType,
          componentSequence: spec.componentSequence,
          cipProjectId: project.id,
          acquisitionSourceType: 'CIP',
          createdBy: userId,
        });
        for (const [component, part] of allocateProportionally(amount, working)) {
          if (part.isZero()) continue;
          const reg = await tx.capitalInvestmentCost.create({
            data: {
              tenantId,
              organizationId,
              cipProjectId: project.id,
              costComponent: component,
              movementKind: 'CAPITALIZATION',
              businessDate: date,
              amount: part.negated().toString(),
              baseAmount: part.negated().toString(),
              sourceDocumentType: FaSourceType.CIP_PROJECT,
              sourceDocumentId: project.id,
              assetId: asset.id,
              description: `Capitalized into ${asset.assetNumber}`,
              createdBy: userId,
            },
          });
          await tx.fixedAssetCostComponent.create({
            data: { tenantId, assetId: asset.id, costComponent: component, amount: part.toString(), cipProjectId: project.id, cipCostId: reg.id, sourceDocumentType: FaSourceType.CIP_PROJECT, sourceDocumentId: project.id, purpose: 'INITIAL_COST', createdBy: userId },
          });
          working.set(component, (working.get(component) ?? new Decimal(0)).minus(part));
        }
        created.push(asset);
      }

      await this.audit.record(
        { tenantId, eventType: 'CAPITAL_INVESTMENT_CAPITALIZED', entityType: 'CapitalInvestmentProject', entityId: project.id, action: 'CAPITALIZE', userId, newValues: { total: total.toString(), assetIds: created.map((a) => a.id), remaining: remaining.minus(total).toString() } },
        tx,
      );
      if (dto.closeProject) await this.cip.closeLocked(tx, tenantId, organizationId, project.id, userId);
      return { assets: created.map((a) => this.assets.redact(a)), capitalized: total.toString(), remainingCip: remaining.minus(total).toString() };
    });
  }

  /**
   * Capitalization reversal before recognition (spec section 134): only an
   * asset still in ACQUISITION (never accepted / commissioned / depreciated
   * / disposed) can be withdrawn. Its candidates return to CAPITALIZABLE and
   * CIP consumption is written back to the CIP register.
   */
  async withdraw(tenantId: string, membershipId: string, organizationId: string, assetId: string, userId: string, reason?: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${assetId} AND tenant_id = ${tenantId} FOR UPDATE`;
      const asset = await tx.fixedAsset.findFirst({ where: { id: assetId, tenantId, organizationId } });
      if (!asset) throw new NotFoundAppError('FixedAsset', assetId);
      if (asset.status !== AssetStatus.ACQUISITION) {
        throw new FixedAssetInvalidStateError(`Capitalization of asset ${asset.assetNumber} cannot be reversed: it is already ${asset.status}. Reverse the later lifecycle documents first.`);
      }
      const components = await tx.fixedAssetCostComponent.findMany({ where: { tenantId, assetId, released: false, recognized: false } });
      for (const comp of components) {
        await tx.fixedAssetCostComponent.update({ where: { id: comp.id }, data: { released: true } });
        if (comp.cipCostId) {
          const orig = await tx.capitalInvestmentCost.findUniqueOrThrow({ where: { id: comp.cipCostId } });
          await tx.capitalInvestmentCost.create({
            data: { tenantId, organizationId, cipProjectId: orig.cipProjectId, costComponent: orig.costComponent, movementKind: 'REVERSAL', businessDate: orig.businessDate, amount: dec(orig.amount).negated().toString(), baseAmount: dec(orig.baseAmount).negated().toString(), sourceDocumentType: orig.sourceDocumentType, sourceDocumentId: orig.sourceDocumentId, assetId, reversalOfId: orig.id, description: `Capitalization of ${asset.assetNumber} withdrawn`, createdBy: userId },
          });
        }
      }
      const candidateIds = [...new Set(components.map((c) => c.candidateId).filter((x): x is string => !!x))];
      for (const cid of candidateIds) {
        const stillUsed = await tx.fixedAssetCostComponent.count({ where: { tenantId, candidateId: cid, released: false } });
        if (stillUsed === 0) {
          const cand = await tx.fixedAssetAcquisitionCandidate.findUniqueOrThrow({ where: { id: cid } });
          // Direct-to-asset assignments (modernization) go back to CAPITALIZABLE too.
          await tx.fixedAssetAcquisitionCandidate.update({ where: { id: cid }, data: { status: cand.assignedCipProjectId ? CandidateStatus.ASSIGNED_TO_CIP : CandidateStatus.CAPITALIZABLE, assignedAssetId: null, version: { increment: 1 } } });
        }
      }
      const updated = await tx.fixedAsset.update({ where: { id: assetId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_CAPITALIZATION_REVERSED', entityType: 'FixedAsset', entityId: assetId, action: 'REVERSE', userId, oldValues: { status: asset.status }, newValues: { status: 'CANCELLED', releasedComponents: components.length }, reason }, tx);
      return this.assets.redact(updated);
    });
  }
}
