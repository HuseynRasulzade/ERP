import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { CipStatus, FaSourceType, dec, formatAmount, toDate } from './fixed-assets.constants';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { CipBalanceExceededError, CipResidualError, FixedAssetInvalidStateError } from './fixed-asset.errors';

const OPEN_STATUSES: string[] = [CipStatus.PLANNED, CipStatus.ACTIVE, CipStatus.SUSPENDED, CipStatus.READY_FOR_CAPITALIZATION];
const TRANSITIONS: Record<string, string[]> = {
  PLANNED: [CipStatus.ACTIVE, CipStatus.CANCELLED],
  ACTIVE: [CipStatus.SUSPENDED, CipStatus.READY_FOR_CAPITALIZATION, CipStatus.CANCELLED],
  SUSPENDED: [CipStatus.ACTIVE, CipStatus.CANCELLED],
  READY_FOR_CAPITALIZATION: [CipStatus.ACTIVE],
};

/**
 * CapitalInvestmentService (spec sections 8-12, 88-91, 109): construction in
 * progress projects and their append-only CapitalInvestmentCost register.
 */
@Injectable()
export class CapitalInvestmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly accounting: FixedAssetAccountingService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { code: string; name: string; projectType?: string; startDate: string; plannedCompletionDate?: string; departmentId?: string; responsiblePersonId?: string; locationId?: string; currencyId?: string; targetAssetCount?: number; targetAssetId?: string; budgetAmount?: number; comment?: string; status?: string },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const dup = await this.prisma.capitalInvestmentProject.findFirst({ where: { tenantId, organizationId, code: dto.code } });
    if (dup) throw new ConflictAppError(`CIP project code ${dto.code} already exists`);
    if (dto.targetAssetId) {
      const asset = await this.prisma.fixedAsset.findFirst({ where: { id: dto.targetAssetId, tenantId, organizationId } });
      if (!asset) throw new NotFoundAppError('FixedAsset', dto.targetAssetId);
    }
    const project = await this.prisma.capitalInvestmentProject.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        projectType: dto.projectType ?? 'NEW_ASSET',
        startDate: toDate(dto.startDate),
        plannedCompletionDate: dto.plannedCompletionDate ? toDate(dto.plannedCompletionDate) : null,
        departmentId: dto.departmentId,
        responsiblePersonId: dto.responsiblePersonId,
        locationId: dto.locationId,
        currencyId: dto.currencyId,
        status: dto.status === CipStatus.PLANNED ? CipStatus.PLANNED : CipStatus.ACTIVE,
        targetAssetCount: dto.targetAssetCount,
        targetAssetId: dto.targetAssetId,
        budgetAmount: dto.budgetAmount !== undefined ? String(dto.budgetAmount) : undefined,
        comment: dto.comment,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'CAPITAL_INVESTMENT_PROJECT_CREATED', entityType: 'CapitalInvestmentProject', entityId: project.id, action: 'CREATE', userId, newValues: { code: project.code, name: project.name } });
    return project;
  }

  async balanceByComponent(tenantId: string, projectId: string, tx?: PrismaTransactionClient, asOf?: Date) {
    const client = tx ?? this.prisma;
    const rows = await client.capitalInvestmentCost.groupBy({
      by: ['costComponent'],
      where: { tenantId, cipProjectId: projectId, ...(asOf ? { businessDate: { lte: asOf } } : {}) },
      _sum: { amount: true },
    });
    const map = new Map<string, Decimal>();
    for (const r of rows) map.set(r.costComponent, dec(r._sum.amount));
    return map;
  }

  async balance(tenantId: string, projectId: string, tx?: PrismaTransactionClient, asOf?: Date) {
    const map = await this.balanceByComponent(tenantId, projectId, tx, asOf);
    let total = new Decimal(0);
    for (const v of map.values()) total = total.plus(v);
    return total;
  }

  async list(tenantId: string, membershipId: string, organizationId: string, filter: { status?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const projects = await this.prisma.capitalInvestmentProject.findMany({
      where: { tenantId, organizationId, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const sums = await this.prisma.capitalInvestmentCost.groupBy({ by: ['cipProjectId', 'movementKind'], where: { tenantId, organizationId }, _sum: { amount: true } });
    return projects.map((p) => {
      const mine = sums.filter((s) => s.cipProjectId === p.id);
      const kind = (k: string) => dec(mine.find((m) => m.movementKind === k)?._sum.amount);
      const additions = kind('ADDITION');
      const capitalized = kind('CAPITALIZATION').negated();
      const expensed = kind('EXPENSE').negated().plus(kind('RECLASSIFICATION').negated());
      const balance = mine.reduce((s, m) => s.plus(dec(m._sum.amount)), new Decimal(0));
      return { ...p, actualCost: additions.toString(), capitalized: capitalized.toString(), expensed: expensed.toString(), balance: balance.toString() };
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const project = await this.prisma.capitalInvestmentProject.findFirst({ where: { id, tenantId, organizationId }, include: { costs: { orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }] } } });
    if (!project) throw new NotFoundAppError('CapitalInvestmentProject', id);
    const byComponent = await this.balanceByComponent(tenantId, id);
    const components: Record<string, { added: string; balance: string }> = {};
    for (const c of project.costs) {
      const e = components[c.costComponent] ?? { added: '0', balance: '0' };
      if (c.movementKind === 'ADDITION') e.added = dec(e.added).plus(dec(c.amount)).toString();
      components[c.costComponent] = e;
    }
    for (const [k, v] of byComponent) components[k] = { ...(components[k] ?? { added: '0', balance: '0' }), balance: v.toString() };
    const assetComponents = await this.prisma.fixedAssetCostComponent.findMany({ where: { tenantId, cipProjectId: id, released: false } });
    const assetIds = [...new Set(assetComponents.map((a) => a.assetId))];
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, assetNumber: true, name: true, status: true, initialCost: true } });
    const candidates = await this.prisma.fixedAssetAcquisitionCandidate.findMany({ where: { tenantId, assignedCipProjectId: id } });
    const total = [...byComponent.values()].reduce((s, v) => s.plus(v), new Decimal(0));
    const added = project.costs.filter((c) => c.movementKind === 'ADDITION').reduce((s, c) => s.plus(dec(c.amount)), new Decimal(0));
    return {
      ...project,
      actualCost: added.toString(),
      balance: total.toString(),
      residual: total.toString(),
      components,
      assetsCreated: assets.map((a) => ({ ...a, fromThisProject: assetComponents.filter((c) => c.assetId === a.id).reduce((s, c) => s.plus(dec(c.amount)), new Decimal(0)).toString() })),
      sources: candidates,
    };
  }

  async setStatus(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, status: string, reason?: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM capital_investment_projects WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
      const p = await tx.capitalInvestmentProject.findFirst({ where: { id, tenantId, organizationId } });
      if (!p) throw new NotFoundAppError('CapitalInvestmentProject', id);
      if (!(TRANSITIONS[p.status] ?? []).includes(status)) throw new FixedAssetInvalidStateError(`CIP project ${p.code} cannot move from ${p.status} to ${status}.`);
      if (status === CipStatus.CANCELLED) {
        const bal = await this.balance(tenantId, id, tx);
        if (!bal.isZero()) throw new CipResidualError(p.code, formatAmount(bal));
      }
      const updated = await tx.capitalInvestmentProject.update({ where: { id }, data: { status, version: { increment: 1 }, ...(status === CipStatus.CANCELLED ? { closedAt: new Date() } : {}) } });
      await this.audit.record({ tenantId, eventType: 'CAPITAL_INVESTMENT_PROJECT_STATUS_CHANGED', entityType: 'CapitalInvestmentProject', entityId: id, action: 'STATUS', userId, oldValues: { status: p.status }, newValues: { status }, reason }, tx);
      return updated;
    });
  }

  /** Internal API (spec section 144 addCapitalizableCost): records a cost
   * whose source posting ALREADY debited the FA_CIP account. */
  async addCapitalizableCost(
    tx: PrismaTransactionClient,
    input: { tenantId: string; organizationId: string; cipProjectId: string; costComponent: string; amount: Decimal.Value; businessDate: Date; sourceDocumentType: string; sourceDocumentId: string; sourceDocumentLineId?: string; candidateId?: string; description?: string; createdBy?: string },
  ) {
    await tx.$queryRaw`SELECT id FROM capital_investment_projects WHERE id = ${input.cipProjectId} AND tenant_id = ${input.tenantId} FOR UPDATE`;
    const p = await tx.capitalInvestmentProject.findFirst({ where: { id: input.cipProjectId, tenantId: input.tenantId, organizationId: input.organizationId } });
    if (!p) throw new NotFoundAppError('CapitalInvestmentProject', input.cipProjectId);
    if (!OPEN_STATUSES.includes(p.status) || p.status === CipStatus.SUSPENDED) throw new FixedAssetInvalidStateError(`CIP project ${p.code} is ${p.status}; costs can no longer be added.`);
    const row = await tx.capitalInvestmentCost.create({
      data: {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        cipProjectId: p.id,
        costComponent: input.costComponent,
        movementKind: 'ADDITION',
        businessDate: input.businessDate,
        amount: dec(input.amount).toString(),
        baseAmount: dec(input.amount).toString(),
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        candidateId: input.candidateId,
        departmentId: p.departmentId,
        description: input.description,
        createdBy: input.createdBy,
      },
    });
    await this.audit.record({ tenantId: input.tenantId, eventType: 'CapitalInvestmentCostAdded', entityType: 'CapitalInvestmentProject', entityId: p.id, action: 'COST_ADDED', userId: input.createdBy, newValues: { amount: dec(input.amount).toString(), costComponent: input.costComponent } }, tx);
    return row;
  }

  /** Expense / reclassify part of the CIP balance (spec sections 90-91):
   * Dr expense  Cr FA_CIP, allocated across components proportionally. */
  async expenseResidual(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: { amount: number; date: string; reason: string; expenseAccountId?: string; kind?: 'EXPENSE' | 'RECLASSIFICATION' },
  ) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.accounting.ensureSetup(tenantId);
    const date = toDate(dto.date);
    const amount = dec(dto.amount);
    if (amount.lte(0)) throw new ValidationAppError('Amount must be positive');
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM capital_investment_projects WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
      const p = await tx.capitalInvestmentProject.findFirst({ where: { id, tenantId, organizationId } });
      if (!p) throw new NotFoundAppError('CapitalInvestmentProject', id);
      if (!OPEN_STATUSES.includes(p.status)) throw new FixedAssetInvalidStateError(`CIP project ${p.code} is ${p.status}.`);
      const byComponent = await this.balanceByComponent(tenantId, id, tx);
      const total = [...byComponent.values()].reduce((s, v) => s.plus(v), new Decimal(0));
      if (amount.gt(total)) throw new CipBalanceExceededError(formatAmount(amount), formatAmount(total));

      let expenseAccountId = dto.expenseAccountId;
      if (expenseAccountId) {
        const acc = await tx.account.findFirst({ where: { id: expenseAccountId, tenantId } });
        if (!acc) throw new NotFoundAppError('Account', expenseAccountId);
      } else {
        expenseAccountId = (await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_NON_CAPITALIZABLE_EXPENSE, date, null, tx)).id;
      }
      const cip = await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_CIP, date, null, tx);
      const sourceId = `${id}:expense:${Date.now()}`;
      const je = await this.accounting.post(
        tenantId,
        userId,
        {
          organizationId,
          businessDate: date,
          description: `CIP ${p.code} — ${dto.kind ?? 'EXPENSE'}: ${dto.reason}`,
          sourceDocumentType: FaSourceType.CIP_PROJECT,
          sourceDocumentId: sourceId,
          lines: [this.accounting.line(expenseAccountId, 'DEBIT', amount, dto.reason, { departmentId: p.departmentId }), this.accounting.line(cip.id, 'CREDIT', amount, `CIP ${p.code}`)],
        },
        tx,
      );
      const allocations = allocateProportionally(amount, byComponent);
      for (const [component, part] of allocations) {
        if (part.isZero()) continue;
        await tx.capitalInvestmentCost.create({
          data: {
            tenantId,
            organizationId,
            cipProjectId: id,
            costComponent: component,
            movementKind: dto.kind ?? 'EXPENSE',
            businessDate: date,
            amount: part.negated().toString(),
            baseAmount: part.negated().toString(),
            sourceDocumentType: FaSourceType.CIP_PROJECT,
            sourceDocumentId: sourceId,
            journalEntryId: je?.id,
            description: dto.reason,
            createdBy: userId,
          },
        });
      }
      await this.audit.record({ tenantId, eventType: 'CapitalInvestmentCostRemoved', entityType: 'CapitalInvestmentProject', entityId: id, action: 'EXPENSE', userId, newValues: { amount: amount.toString(), journalEntryId: je?.id }, reason: dto.reason }, tx);
      return { projectId: id, expensed: amount.toString(), journalEntryId: je?.id ?? null, balance: total.minus(amount).toString() };
    });
  }

  /** Close as CAPITALIZED — refused while any unexplained residual remains
   * (spec section 90). */
  async close(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM capital_investment_projects WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
      return this.closeLocked(tx, tenantId, organizationId, id, userId);
    });
  }

  async closeLocked(tx: PrismaTransactionClient, tenantId: string, organizationId: string, id: string, userId: string) {
    const p = await tx.capitalInvestmentProject.findFirst({ where: { id, tenantId, organizationId } });
    if (!p) throw new NotFoundAppError('CapitalInvestmentProject', id);
    if (!OPEN_STATUSES.includes(p.status)) throw new FixedAssetInvalidStateError(`CIP project ${p.code} is ${p.status}.`);
    const bal = await this.balance(tenantId, id, tx);
    if (!bal.isZero()) throw new CipResidualError(p.code, formatAmount(bal));
    const updated = await tx.capitalInvestmentProject.update({ where: { id }, data: { status: CipStatus.CAPITALIZED, closedAt: new Date(), version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'CAPITAL_INVESTMENT_PROJECT_CLOSED', entityType: 'CapitalInvestmentProject', entityId: id, action: 'CLOSE', userId, oldValues: { status: p.status }, newValues: { status: CipStatus.CAPITALIZED } }, tx);
    return updated;
  }
}

/** Splits `amount` across component balances proportionally; the last
 * component absorbs the rounding remainder so the parts sum exactly. */
export function allocateProportionally(amount: Decimal, byComponent: Map<string, Decimal>): [string, Decimal][] {
  const entries = [...byComponent.entries()].filter(([, v]) => v.gt(0));
  const total = entries.reduce((s, [, v]) => s.plus(v), new Decimal(0));
  if (total.isZero()) return [];
  const result: [string, Decimal][] = [];
  let allocated = new Decimal(0);
  entries.forEach(([k, v], i) => {
    const part = i === entries.length - 1 ? amount.minus(allocated) : amount.mul(v).div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    allocated = allocated.plus(part);
    result.push([k, part]);
  });
  return result;
}
