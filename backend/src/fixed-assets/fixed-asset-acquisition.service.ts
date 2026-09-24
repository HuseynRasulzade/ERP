import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import {
  AssetStatus,
  CandidateDecision,
  CandidateStatus,
  CipStatus,
  CLOSED_STATUSES,
  FaSourceType,
  dec,
  formatAmount,
  toDate,
} from './fixed-assets.constants';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { CandidateAlreadyProcessedError, FixedAssetInvalidStateError, FixedAssetPolicyViolationError } from './fixed-asset.errors';

export interface CreateCandidateInput {
  tenantId: string;
  organizationId: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  sourceDocumentNumber?: string | null;
  sourceDate: Date;
  supplierId?: string | null;
  productId?: string | null;
  description: string;
  quantity?: Decimal.Value;
  currencyId?: string | null;
  transactionAmount: Decimal.Value;
  baseAmount: Decimal.Value;
  taxAmount?: Decimal.Value;
  nonRecoverableTaxAmount?: Decimal.Value;
  capitalizableAmount?: Decimal.Value;
  candidateType: string;
  costComponent?: string;
  glRecognized?: boolean;
  createdBy?: string | null;
  splitFromCandidateId?: string | null;
}

export interface ClassifyInput {
  decision: string;
  reason?: string;
  costComponent?: string;
  cipProjectId?: string;
  assetId?: string;
  expenseAccountId?: string;
  overridePolicy?: boolean;
  categoryId?: string;
  parts?: { amount: number; description?: string; costComponent?: string }[];
}

const OPEN_CANDIDATE_STATUSES: string[] = [CandidateStatus.NEW, CandidateStatus.UNDER_REVIEW, CandidateStatus.CAPITALIZABLE];

/**
 * FixedAssetAcquisitionService (spec sections 4-7, 108, 129-131): the
 * acquisition-candidate layer. A candidate NEVER creates an asset by itself
 * (section 167) — a human capitalization decision is always recorded and
 * audited first.
 */
@Injectable()
export class FixedAssetAcquisitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly policies: DepreciationPolicyService,
    private readonly documents: FixedAssetDocumentService,
  ) {}

  /** Internal API (spec section 144 createAcquisitionCandidate). Idempotent
   * on (source type, source id, source line): the same purchase-invoice
   * event twice yields ONE candidate (section 129). Call `prepare` first
   * when invoking inside an outer transaction. */
  async createCandidate(input: CreateCandidateInput, tx?: PrismaTransactionClient) {
    const run = async (client: PrismaTransactionClient) => {
      const sourceKey = `${input.sourceDocumentType}:${input.sourceDocumentId}:${input.sourceDocumentLineId ?? '-'}`;
      const existing = await client.fixedAssetAcquisitionCandidate.findUnique({ where: { tenantId_sourceKey: { tenantId: input.tenantId, sourceKey } } });
      if (existing) return existing;

      const capitalizable = dec(input.capitalizableAmount ?? input.baseAmount);
      const component = input.costComponent ?? 'PURCHASE_PRICE';
      const policy = await this.policies.resolvePolicy(input.tenantId, input.organizationId, null, input.sourceDate, undefined, client);
      const recommendation = policy.nonCapitalizableCostComponents.includes(component) || capitalizable.lt(policy.minCapitalizationThreshold)
        ? CandidateDecision.EXPENSE
        : CandidateDecision.CAPITALIZE;
      const number = await this.documents.allocate(client, input.tenantId, 'FA_CANDIDATE', input.sourceDate);

      const created = await client.fixedAssetAcquisitionCandidate.create({
        data: {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          number,
          sourceKey,
          sourceDocumentType: input.sourceDocumentType,
          sourceDocumentId: input.sourceDocumentId,
          sourceDocumentLineId: input.sourceDocumentLineId ?? null,
          sourceDocumentNumber: input.sourceDocumentNumber ?? null,
          sourceDate: input.sourceDate,
          supplierId: input.supplierId ?? null,
          productId: input.productId ?? null,
          description: input.description,
          quantity: dec(input.quantity ?? 1).toString(),
          currencyId: input.currencyId ?? null,
          transactionAmount: dec(input.transactionAmount).toString(),
          baseAmount: dec(input.baseAmount).toString(),
          taxAmount: dec(input.taxAmount).toString(),
          nonRecoverableTaxAmount: dec(input.nonRecoverableTaxAmount).toString(),
          capitalizableAmount: capitalizable.toString(),
          candidateType: input.candidateType,
          costComponent: component,
          glRecognized: input.glRecognized ?? true,
          policyRecommendation: recommendation,
          splitFromCandidateId: input.splitFromCandidateId ?? null,
          createdBy: input.createdBy ?? null,
        },
      });
      await this.audit.record(
        {
          tenantId: input.tenantId,
          eventType: 'FixedAssetCandidateCreated',
          entityType: 'FixedAssetAcquisitionCandidate',
          entityId: created.id,
          action: 'CREATE',
          userId: input.createdBy ?? undefined,
          newValues: { number, sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId, capitalizableAmount: capitalizable.toString(), recommendation },
        },
        client,
      );
      return created;
    };
    return tx ? run(tx) : this.prisma.runInTransaction(run);
  }

  async prepare(tenantId: string) {
    await this.accounting.ensureSetup(tenantId);
    await this.documents.ensureSequence(tenantId, 'FA_CANDIDATE');
  }

  /** Source document unposted: withdraw its still-unprocessed candidates;
   * refuse when one has already been decided on (dependency-safe unpost). */
  async withdrawForSource(tx: PrismaTransactionClient, tenantId: string, sourceDocumentType: string, sourceDocumentId: string, userId?: string) {
    const rows = await tx.fixedAssetAcquisitionCandidate.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
    const processed = rows.filter((r) => !OPEN_CANDIDATE_STATUSES.includes(r.status) && r.status !== CandidateStatus.CANCELLED);
    if (processed.length > 0) {
      throw new FixedAssetInvalidStateError(
        `Source document cannot be unposted: fixed-asset acquisition candidate ${processed[0].number} has already been processed (${processed[0].status}).`,
      );
    }
    for (const r of rows) {
      if (r.status === CandidateStatus.CANCELLED) continue;
      // A candidate is keyed by its source; re-keying the withdrawn row lets a
      // repost of the same source create a fresh candidate.
      await tx.fixedAssetAcquisitionCandidate.update({
        where: { id: r.id },
        data: { status: CandidateStatus.CANCELLED, decisionReason: 'Source document unposted', sourceKey: `${r.sourceKey}#withdrawn:${r.id}`, version: { increment: 1 } },
      });
      await this.audit.record({ tenantId, eventType: 'FixedAssetCandidateWithdrawn', entityType: 'FixedAssetAcquisitionCandidate', entityId: r.id, action: 'CANCEL', userId }, tx);
    }
  }

  async createManual(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { description: string; amount: number; sourceDate: string; costComponent?: string; candidateType?: string; offsetAccountId: string; supplierId?: string; productId?: string; quantity?: number; reference?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.prepare(tenantId);
    const account = await this.prisma.account.findFirst({ where: { id: dto.offsetAccountId, tenantId } });
    if (!account) throw new NotFoundAppError('Account', dto.offsetAccountId);
    const date = toDate(dto.sourceDate);
    return this.prisma.runInTransaction(async (tx) => {
      const id = randomUUID();
      const cip = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_CIP, date, null, tx);
      const candidate = await this.createCandidate(
        {
          tenantId,
          organizationId,
          sourceDocumentType: 'MANUAL_CAPITALIZATION',
          sourceDocumentId: id,
          sourceDocumentNumber: dto.reference ?? null,
          sourceDate: date,
          supplierId: dto.supplierId,
          productId: dto.productId,
          description: dto.description,
          quantity: dto.quantity ?? 1,
          transactionAmount: dto.amount,
          baseAmount: dto.amount,
          candidateType: dto.candidateType ?? 'MANUAL',
          costComponent: dto.costComponent,
          glRecognized: true,
          createdBy: userId,
        },
        tx,
      );
      const je = await this.accounting.post(
        tenantId,
        userId,
        {
          organizationId,
          businessDate: date,
          description: `Manual capitalization candidate ${candidate.number}`,
          sourceDocumentType: 'MANUAL_CAPITALIZATION',
          sourceDocumentId: id,
          lines: [
            this.accounting.line(cip.id, 'DEBIT', dto.amount, `Acquisition clearing — ${dto.description}`),
            this.accounting.line(account.id, 'CREDIT', dto.amount, `Manual capitalization source — ${dto.description}`),
          ],
        },
        tx,
      );
      return { ...candidate, journalEntryId: je?.id ?? null };
    });
  }

  async list(tenantId: string, membershipId: string, organizationId: string, filter: { status?: string; unprocessed?: boolean; sourceDocumentId?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetAcquisitionCandidate.findMany({
      where: {
        tenantId,
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.unprocessed ? { status: { in: OPEN_CANDIDATE_STATUSES } } : {}),
        ...(filter.sourceDocumentId ? { sourceDocumentId: filter.sourceDocumentId } : {}),
      },
      orderBy: [{ sourceDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const c = await this.prisma.fixedAssetAcquisitionCandidate.findFirst({ where: { id, tenantId, organizationId } });
    if (!c) throw new NotFoundAppError('FixedAssetAcquisitionCandidate', id);
    const [children, cipCosts, costComponents] = await Promise.all([
      this.prisma.fixedAssetAcquisitionCandidate.findMany({ where: { tenantId, splitFromCandidateId: id } }),
      this.prisma.capitalInvestmentCost.findMany({ where: { tenantId, candidateId: id } }),
      this.prisma.fixedAssetCostComponent.findMany({ where: { tenantId, candidateId: id } }),
    ]);
    return { ...c, children, cipCosts, costComponents };
  }

  /**
   * Capitalization decision (spec sections 6, 48, 128, 131): capitalize /
   * expense / split / assign to CIP / assign to an existing asset. The
   * candidate row is locked (FOR UPDATE) and its status re-checked inside
   * the transaction, so two concurrent decisions can never both consume it.
   */
  async classify(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: ClassifyInput,
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.prepare(tenantId);
    return this.prisma.runInTransaction((tx) => this.classifyInTx(tx, tenantId, organizationId, id, userId, dto));
  }

  async classifyInTx(tx: PrismaTransactionClient, tenantId: string, organizationId: string, id: string, userId: string, dto: ClassifyInput) {
    {
      await tx.$queryRaw`SELECT id FROM fixed_asset_acquisition_candidates WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
      const c = await tx.fixedAssetAcquisitionCandidate.findFirst({ where: { id, tenantId, organizationId } });
      if (!c) throw new NotFoundAppError('FixedAssetAcquisitionCandidate', id);
      if (!OPEN_CANDIDATE_STATUSES.includes(c.status)) throw new CandidateAlreadyProcessedError(c.number ?? c.id, c.status);

      const amount = dec(c.capitalizableAmount);
      const component = dto.costComponent ?? c.costComponent;
      const oldStatus = c.status;
      let newStatus: string;
      const extra: Record<string, unknown> = {};
      const date = c.sourceDate;

      switch (dto.decision) {
        case CandidateDecision.UNDER_REVIEW:
          newStatus = CandidateStatus.UNDER_REVIEW;
          break;

        case CandidateDecision.CAPITALIZE: {
          const category = dto.categoryId ? await tx.fixedAssetCategory.findFirst({ where: { id: dto.categoryId, tenantId } }) : null;
          const policy = await this.policies.resolvePolicy(tenantId, organizationId, category?.id ?? null, date, undefined, tx);
          const threshold = category?.capitalizationThreshold ? dec(category.capitalizationThreshold) : policy.minCapitalizationThreshold;
          if (policy.nonCapitalizableCostComponents.includes(component) && !dto.overridePolicy) {
            throw new FixedAssetPolicyViolationError(`Cost component ${component} is non-capitalizable under the capitalization policy; it must be expensed (or explicitly overridden with a reason).`);
          }
          if (amount.lt(threshold) && !dto.overridePolicy) {
            throw new FixedAssetPolicyViolationError(`Amount ${formatAmount(amount)} is below the capitalization threshold of ${formatAmount(threshold)}; expense it or override the policy with a reason.`);
          }
          if (dto.overridePolicy && !dto.reason) throw new ValidationAppError('A policy override requires a reason');
          newStatus = CandidateStatus.CAPITALIZABLE;
          break;
        }

        case CandidateDecision.EXPENSE: {
          let expenseAccountId = dto.expenseAccountId;
          if (expenseAccountId) {
            const acc = await tx.account.findFirst({ where: { id: expenseAccountId, tenantId } });
            if (!acc) throw new NotFoundAppError('Account', expenseAccountId);
          } else {
            const key = component === 'REPAIR' ? MappingKeys.FA_REPAIR_EXPENSE : MappingKeys.FA_NON_CAPITALIZABLE_EXPENSE;
            expenseAccountId = (await this.accounting.resolve(tenantId, organizationId, key, date, null, tx)).id;
          }
          if (c.glRecognized && amount.gt(0)) {
            const cip = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_CIP, date, null, tx);
            const je = await this.accounting.post(
              tenantId,
              userId,
              {
                organizationId,
                businessDate: date,
                description: `Non-capitalizable cost expensed — candidate ${c.number}`,
                sourceDocumentType: FaSourceType.CANDIDATE,
                sourceDocumentId: c.id,
                lines: [
                  this.accounting.line(expenseAccountId, 'DEBIT', amount, `${c.description} (${component})`),
                  this.accounting.line(cip.id, 'CREDIT', amount, `Acquisition clearing — candidate ${c.number}`),
                ],
              },
              tx,
            );
            extra.expenseJournalEntryId = je?.id ?? null;
          }
          newStatus = CandidateStatus.EXPENSE;
          break;
        }

        case CandidateDecision.SPLIT: {
          if (!dto.parts || dto.parts.length < 2) throw new ValidationAppError('A split needs at least two parts');
          const total = dto.parts.reduce((s, p) => s.plus(dec(p.amount)), new Decimal(0));
          if (!total.eq(amount)) throw new ValidationAppError(`Split parts total ${formatAmount(total)} must equal the candidate amount ${formatAmount(amount)}`);
          if (dto.parts.some((p) => dec(p.amount).lte(0))) throw new ValidationAppError('Every split part must be positive');
          const ratio = (p: { amount: number }) => dec(p.amount).div(amount);
          for (const [i, part] of dto.parts.entries()) {
            await this.createCandidate(
              {
                tenantId,
                organizationId,
                sourceDocumentType: c.sourceDocumentType,
                sourceDocumentId: c.sourceDocumentId,
                sourceDocumentLineId: `${c.sourceDocumentLineId ?? '-'}#split${i + 1}:${c.id}`,
                sourceDocumentNumber: c.sourceDocumentNumber,
                sourceDate: c.sourceDate,
                supplierId: c.supplierId,
                productId: c.productId,
                description: part.description ?? `${c.description} (part ${i + 1})`,
                quantity: c.quantity,
                currencyId: c.currencyId,
                transactionAmount: dec(c.transactionAmount).mul(ratio(part)).toDecimalPlaces(4),
                baseAmount: dec(part.amount),
                taxAmount: dec(c.taxAmount).mul(ratio(part)).toDecimalPlaces(4),
                capitalizableAmount: dec(part.amount),
                candidateType: c.candidateType,
                costComponent: part.costComponent ?? c.costComponent,
                glRecognized: c.glRecognized,
                createdBy: userId,
                splitFromCandidateId: c.id,
              },
              tx,
            );
          }
          newStatus = CandidateStatus.CANCELLED;
          break;
        }

        case CandidateDecision.ASSIGN_TO_CIP: {
          if (!dto.cipProjectId) throw new ValidationAppError('cipProjectId is required');
          await tx.$queryRaw`SELECT id FROM capital_investment_projects WHERE id = ${dto.cipProjectId} AND tenant_id = ${tenantId} FOR UPDATE`;
          const project = await tx.capitalInvestmentProject.findFirst({ where: { id: dto.cipProjectId, tenantId, organizationId } });
          if (!project) throw new NotFoundAppError('CapitalInvestmentProject', dto.cipProjectId);
          if (![CipStatus.PLANNED, CipStatus.ACTIVE, CipStatus.READY_FOR_CAPITALIZATION].includes(project.status as any)) {
            throw new FixedAssetInvalidStateError(`CIP project ${project.code} is ${project.status}; costs can no longer be added.`);
          }
          if (!c.glRecognized) throw new FixedAssetInvalidStateError(`Candidate ${c.number} has no GL recognition on the CIP account; it cannot be assigned to CIP.`);
          const cost = await tx.capitalInvestmentCost.create({
            data: {
              tenantId,
              organizationId,
              cipProjectId: project.id,
              costComponent: component,
              movementKind: 'ADDITION',
              businessDate: date,
              amount: amount.toString(),
              baseAmount: amount.toString(),
              sourceDocumentType: c.sourceDocumentType,
              sourceDocumentId: c.sourceDocumentId,
              sourceDocumentLineId: c.sourceDocumentLineId,
              candidateId: c.id,
              departmentId: project.departmentId,
              description: c.description,
              createdBy: userId,
            },
          });
          if (project.status === CipStatus.PLANNED) await tx.capitalInvestmentProject.update({ where: { id: project.id }, data: { status: CipStatus.ACTIVE, version: { increment: 1 } } });
          await this.audit.record(
            { tenantId, eventType: 'CapitalInvestmentCostAdded', entityType: 'CapitalInvestmentProject', entityId: project.id, action: 'COST_ADDED', userId, newValues: { costId: cost.id, amount: amount.toString(), costComponent: component, candidateId: c.id } },
            tx,
          );
          extra.assignedCipProjectId = project.id;
          newStatus = CandidateStatus.ASSIGNED_TO_CIP;
          break;
        }

        case CandidateDecision.ASSIGN_TO_ASSET: {
          if (!dto.assetId) throw new ValidationAppError('assetId is required');
          const asset = await tx.fixedAsset.findFirst({ where: { id: dto.assetId, tenantId, organizationId } });
          if (!asset) throw new NotFoundAppError('FixedAsset', dto.assetId);
          if (CLOSED_STATUSES.includes(asset.status)) throw new FixedAssetInvalidStateError(`Asset ${asset.assetNumber} is ${asset.status}; costs cannot be assigned to it.`);
          if (!c.glRecognized) throw new FixedAssetInvalidStateError(`Candidate ${c.number} has no GL recognition on the CIP account.`);
          const initial = asset.status === AssetStatus.ACQUISITION;
          await tx.fixedAssetCostComponent.create({
            data: {
              tenantId,
              assetId: asset.id,
              costComponent: component,
              amount: amount.toString(),
              candidateId: c.id,
              sourceDocumentType: c.sourceDocumentType,
              sourceDocumentId: c.sourceDocumentId,
              sourceDocumentLineId: c.sourceDocumentLineId,
              purpose: initial ? 'INITIAL_COST' : 'MODERNIZATION',
              description: c.description,
              createdBy: userId,
            },
          });
          extra.assignedAssetId = asset.id;
          newStatus = CandidateStatus.ASSIGNED_TO_ASSET;
          break;
        }

        default:
          throw new ValidationAppError(`Unknown decision ${dto.decision}`);
      }

      const updated = await tx.fixedAssetAcquisitionCandidate.update({
        where: { id: c.id },
        data: {
          status: newStatus,
          decision: dto.decision,
          decisionReason: dto.reason,
          decidedAt: new Date(),
          decidedBy: userId,
          costComponent: component,
          ...(extra as any),
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'FixedAssetCandidateClassified',
          entityType: 'FixedAssetAcquisitionCandidate',
          entityId: c.id,
          action: 'CLASSIFY',
          userId,
          oldValues: { status: oldStatus },
          newValues: { status: newStatus, decision: dto.decision, costComponent: component, ...extra, overridePolicy: dto.overridePolicy ?? false },
          reason: dto.reason,
          metadata: { sourceDocumentType: c.sourceDocumentType, sourceDocumentId: c.sourceDocumentId },
        },
        tx,
      );
      return updated;
    }
  }
}
