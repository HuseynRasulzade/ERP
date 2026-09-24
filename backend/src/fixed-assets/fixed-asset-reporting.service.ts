import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  AssetStatus,
  Books,
  CANDIDATE_PENDING_STATUSES,
  FaDocumentType,
  IN_USE_STATUSES,
  InventoryResult,
  MovementType,
  RECOGNIZED_STATUSES,
  addDays,
  daysBetween,
  dec,
  isoDate,
  toDate,
} from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetReconciliationService } from './fixed-asset-reconciliation.service';
import { DepreciationPolicyService } from './depreciation-policy.service';

type Sums = { costIn: Decimal; costOut: Decimal; depIn: Decimal; depOut: Decimal; impIn: Decimal; impOut: Decimal; revIn: Decimal; revOut: Decimal };
const zeroSums = (): Sums => ({ costIn: new Decimal(0), costOut: new Decimal(0), depIn: new Decimal(0), depOut: new Decimal(0), impIn: new Decimal(0), impOut: new Decimal(0), revIn: new Decimal(0), revOut: new Decimal(0) });

const ACQUISITION_TYPES: string[] = [MovementType.INITIAL_RECOGNITION, MovementType.OPENING_BALANCE, MovementType.CAPITALIZATION];
const DISPOSAL_TYPES: string[] = [MovementType.FULL_DISPOSAL, MovementType.PARTIAL_DISPOSAL, MovementType.WRITE_OFF];

/**
 * FixedAssetReportingService (spec sections 114-123, 102, 144): every
 * report is computed from the authoritative registers (movements,
 * depreciation lines, CIP register, documents) — never from the mutable
 * projection columns — so historical as-of values are always available.
 */
@Injectable()
export class FixedAssetReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly reconciliation: FixedAssetReconciliationService,
    private readonly policies: DepreciationPolicyService,
  ) {}

  private async movementSums(tenantId: string, organizationId: string, where: Record<string, unknown>) {
    const rows = await this.prisma.fixedAssetMovement.groupBy({
      by: ['assetId', 'movementType'],
      where: { tenantId, organizationId, bookCode: Books.ACCOUNTING_BOOK, ...where },
      _sum: { costIncrease: true, costDecrease: true, depreciationIncrease: true, depreciationDecrease: true, impairmentIncrease: true, impairmentDecrease: true, revaluationIncrease: true, revaluationDecrease: true },
    });
    const map = new Map<string, Map<string, Sums>>();
    for (const r of rows) {
      const m = map.get(r.assetId) ?? new Map<string, Sums>();
      m.set(r.movementType, {
        costIn: dec(r._sum.costIncrease),
        costOut: dec(r._sum.costDecrease),
        depIn: dec(r._sum.depreciationIncrease),
        depOut: dec(r._sum.depreciationDecrease),
        impIn: dec(r._sum.impairmentIncrease),
        impOut: dec(r._sum.impairmentDecrease),
        revIn: dec(r._sum.revaluationIncrease),
        revOut: dec(r._sum.revaluationDecrease),
      });
      map.set(r.assetId, m);
    }
    return map;
  }

  private total(m: Map<string, Sums> | undefined, types?: string[]): Sums {
    const t = zeroSums();
    if (!m) return t;
    for (const [type, s] of m) {
      if (types && !types.includes(type)) continue;
      for (const k of Object.keys(t) as (keyof Sums)[]) t[k] = t[k].plus(s[k]);
    }
    return t;
  }

  /** Report 114 — Fixed Asset Register (as of a date). */
  async register(tenantId: string, membershipId: string, organizationId: string, q: { asOf?: string; categoryId?: string; status?: string; departmentId?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const asOf = q.asOf ? toDate(q.asOf) : toDate(new Date());
    const assets = await this.prisma.fixedAsset.findMany({
      where: { tenantId, organizationId, status: { notIn: ['ACQUISITION', 'CANCELLED'] }, ...(q.categoryId ? { categoryId: q.categoryId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.departmentId ? { departmentId: q.departmentId } : {}) },
      include: { category: { select: { code: true, name: true } } },
      orderBy: { assetNumber: 'asc' },
    });
    const sums = await this.movementSums(tenantId, organizationId, { businessDate: { lte: asOf } });
    const rows = assets.map((a) => {
      const m = sums.get(a.id);
      const acq = this.total(m, ACQUISITION_TYPES);
      const add = this.total(m, [MovementType.MODERNIZATION, MovementType.REVALUATION_INCREASE, MovementType.REVALUATION_DECREASE]);
      const disp = this.total(m, DISPOSAL_TYPES);
      const all = this.total(m);
      const gross = all.costIn.minus(all.costOut).plus(all.revIn).minus(all.revOut);
      const accDep = all.depIn.minus(all.depOut);
      const imp = all.impIn.minus(all.impOut);
      return {
        assetId: a.id,
        assetNumber: a.assetNumber,
        inventoryNumber: a.inventoryNumber,
        name: a.name,
        category: a.category.name,
        commissioningDate: isoDate(a.commissioningDate),
        initialCost: acq.costIn.minus(acq.costOut).toFixed(2),
        additions: add.costIn.minus(add.costOut).plus(add.revIn).minus(add.revOut).toFixed(2),
        disposals: disp.costOut.minus(disp.costIn).plus(disp.revOut).minus(disp.revIn).toFixed(2),
        grossCost: gross.toFixed(2),
        accumulatedDepreciation: accDep.toFixed(2),
        impairment: imp.toFixed(2),
        netBookValue: gross.minus(accDep).minus(imp).toFixed(2),
        departmentId: a.departmentId,
        responsiblePersonId: a.responsiblePersonId,
        locationId: a.locationId,
        status: a.status,
      };
    });
    const totals = rows.reduce(
      (t, r) => ({ grossCost: t.grossCost.plus(r.grossCost), accumulatedDepreciation: t.accumulatedDepreciation.plus(r.accumulatedDepreciation), impairment: t.impairment.plus(r.impairment), netBookValue: t.netBookValue.plus(r.netBookValue) }),
      { grossCost: new Decimal(0), accumulatedDepreciation: new Decimal(0), impairment: new Decimal(0), netBookValue: new Decimal(0) },
    );
    return { asOf: isoDate(asOf), rows, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)])) };
  }

  /** Report 115 — Depreciation schedule (posted history, optionally one asset). */
  async depreciationSchedule(tenantId: string, membershipId: string, organizationId: string, q: { assetId?: string; fromPeriod?: string; toPeriod?: string; bookCode?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const lines = await this.prisma.fixedAssetDepreciationLine.findMany({
      where: {
        tenantId,
        status: 'POSTED',
        bookCode: q.bookCode ?? Books.ACCOUNTING_BOOK,
        run: { organizationId },
        ...(q.assetId ? { assetId: q.assetId } : {}),
        ...(q.fromPeriod || q.toPeriod ? { period: { ...(q.fromPeriod ? { gte: q.fromPeriod } : {}), ...(q.toPeriod ? { lte: q.toPeriod } : {}) } } : {}),
      },
      orderBy: [{ assetId: 'asc' }, { period: 'asc' }],
    });
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.assetId))] } }, select: { id: true, assetNumber: true, name: true } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return lines.map((l) => ({
      assetId: l.assetId,
      assetNumber: byId.get(l.assetId)?.assetNumber,
      assetName: byId.get(l.assetId)?.name,
      period: l.period,
      openingNbv: l.openingNbv.toString(),
      depreciation: l.depreciationAmount.toString(),
      accumulatedDepreciation: l.closingAccumulatedDepreciation.toString(),
      closingNbv: l.closingNbv.toString(),
      remainingUsefulLife: l.remainingLifeBefore !== null ? l.remainingLifeBefore - 1 : null,
    }));
  }

  /** Report 116 — Fixed asset movements for a date range (roll-forward). */
  async movements(tenantId: string, membershipId: string, organizationId: string, q: { from: string; to: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const from = toDate(q.from);
    const to = toDate(q.to);
    const opening = await this.movementSums(tenantId, organizationId, { businessDate: { lt: from } });
    const inRange = await this.movementSums(tenantId, organizationId, { businessDate: { gte: from, lte: to } });
    const transfers = await this.prisma.fixedAssetMovement.groupBy({ by: ['assetId'], where: { tenantId, organizationId, movementType: MovementType.TRANSFER, businessDate: { gte: from, lte: to }, reversalOfMovementId: null }, _count: { _all: true } });
    const transferCount = new Map(transfers.map((t) => [t.assetId, t._count._all]));
    const ids = [...new Set([...opening.keys(), ...inRange.keys()])];
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: ids } }, select: { id: true, assetNumber: true, name: true } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    const net = (s: Sums) => s.costIn.minus(s.costOut).plus(s.revIn).minus(s.revOut);
    const rows = ids.map((id) => {
      const o = this.total(opening.get(id));
      const r = inRange.get(id);
      const acquisitions = net(this.total(r, ACQUISITION_TYPES));
      const improvements = net(this.total(r, [MovementType.MODERNIZATION]));
      const revaluation = net(this.total(r, [MovementType.REVALUATION_INCREASE, MovementType.REVALUATION_DECREASE]));
      const disposals = net(this.total(r, DISPOSAL_TYPES)).negated();
      const all = this.total(r);
      return {
        assetId: id,
        assetNumber: byId.get(id)?.assetNumber,
        assetName: byId.get(id)?.name,
        openingCost: net(o).toFixed(2),
        acquisitions: acquisitions.toFixed(2),
        capitalizedImprovements: improvements.toFixed(2),
        revaluation: revaluation.toFixed(2),
        transfers: transferCount.get(id) ?? 0,
        disposals: disposals.toFixed(2),
        closingCost: net(o).plus(net(all)).toFixed(2),
        depreciationMovement: all.depIn.minus(all.depOut).toFixed(2),
        impairmentMovement: all.impIn.minus(all.impOut).toFixed(2),
      };
    });
    const sum = (k: string) => rows.reduce((s, r) => s.plus((r as any)[k]), new Decimal(0)).toFixed(2);
    return {
      from: q.from,
      to: q.to,
      rows,
      totals: { openingCost: sum('openingCost'), acquisitions: sum('acquisitions'), capitalizedImprovements: sum('capitalizedImprovements'), revaluation: sum('revaluation'), disposals: sum('disposals'), closingCost: sum('closingCost'), depreciationMovement: sum('depreciationMovement'), impairmentMovement: sum('impairmentMovement') },
    };
  }

  /** Report 117 / section 91 — CIP roll-forward. */
  async cip(tenantId: string, membershipId: string, organizationId: string, q: { from: string; to: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const from = toDate(q.from);
    const to = toDate(q.to);
    const projects = await this.prisma.capitalInvestmentProject.findMany({ where: { tenantId, organizationId }, include: { costs: true }, orderBy: { code: 'asc' } });
    return projects.map((p) => {
      const before = p.costs.filter((c) => c.businessDate < from);
      const range = p.costs.filter((c) => c.businessDate >= from && c.businessDate <= to);
      const sum = (rows: typeof p.costs, kinds?: string[]) => rows.filter((c) => !kinds || kinds.includes(c.movementKind)).reduce((s, c) => s.plus(dec(c.amount)), new Decimal(0));
      const opening = sum(before);
      const additions = sum(range, ['ADDITION']);
      const capitalized = sum(range, ['CAPITALIZATION']).negated();
      const expensed = sum(range, ['EXPENSE', 'RECLASSIFICATION']).negated();
      const reversals = sum(range, ['REVERSAL']);
      return {
        projectId: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        openingCip: opening.toFixed(2),
        additions: additions.toFixed(2),
        capitalized: capitalized.toFixed(2),
        expensedReclassified: expensed.toFixed(2),
        reversals: reversals.toFixed(2),
        closingCip: opening.plus(sum(range)).toFixed(2),
        ageDays: daysBetween(p.startDate, to),
      };
    });
  }

  /** Report 118 — fully depreciated assets still in use. */
  async fullyDepreciated(tenantId: string, membershipId: string, organizationId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const assets = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { in: IN_USE_STATUSES } }, orderBy: { assetNumber: 'asc' } });
    const out = [];
    for (const a of assets) {
      const b = await this.ledger.balances(tenantId, a.id);
      const bp = await this.policies.latestBookPolicy(tenantId, a.id, Books.ACCOUNTING_BOOK);
      const residual = bp ? dec(bp.residualValue) : new Decimal(0);
      if (b.grossCarrying.gt(0) && b.netBookValue.lte(residual)) {
        out.push({ assetId: a.id, assetNumber: a.assetNumber, name: a.name, status: a.status, cost: b.grossCarrying.toFixed(2), accumulatedDepreciation: b.accumulatedDepreciation.toFixed(2), netBookValue: b.netBookValue.toFixed(2), residualValue: residual.toFixed(2), commissioningDate: isoDate(a.commissioningDate) });
      }
    }
    return out;
  }

  /** Report 119 — accepted / acquired assets waiting for commissioning. */
  async notCommissioned(tenantId: string, membershipId: string, organizationId: string, q: { asOf?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const asOf = q.asOf ? toDate(q.asOf) : toDate(new Date());
    const assets = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { in: [AssetStatus.ACQUISITION, AssetStatus.ACCEPTED, AssetStatus.NOT_COMMISSIONED] } }, orderBy: { assetNumber: 'asc' } });
    const out = [];
    for (const a of assets) {
      const b = await this.ledger.balances(tenantId, a.id);
      const comps = a.status === AssetStatus.ACQUISITION ? await this.prisma.fixedAssetCostComponent.aggregate({ where: { tenantId, assetId: a.id, released: false }, _sum: { amount: true } }) : null;
      const since = a.acceptanceDate ?? a.acquisitionDate ?? a.createdAt;
      out.push({
        assetId: a.id,
        assetNumber: a.assetNumber,
        name: a.name,
        status: a.status,
        acquisitionDate: isoDate(a.acquisitionDate),
        acceptanceDate: isoDate(a.acceptanceDate),
        cost: (comps ? dec(comps._sum.amount) : b.cost).toFixed(2),
        daysPending: daysBetween(toDate(since), asOf),
        departmentId: a.departmentId,
        responsiblePersonId: a.responsiblePersonId,
      });
    }
    return out;
  }

  /** Report 120 — inventory differences. */
  async inventoryDifferences(tenantId: string, membershipId: string, organizationId: string, q: { countId?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const results = await this.prisma.fixedAssetInventoryResult.findMany({ where: { tenantId, count: { organizationId, ...(q.countId ? { id: q.countId } : {}) } }, include: { count: { select: { number: true, countDate: true, status: true } } } });
    const summary: Record<string, number> = { EXPECTED: results.filter((r) => r.result !== InventoryResult.UNREGISTERED_ASSET).length };
    for (const r of results) summary[r.result] = (summary[r.result] ?? 0) + 1;
    return { summary, differences: results.filter((r) => r.result !== InventoryResult.FOUND && r.result !== InventoryResult.PENDING) };
  }

  /** Report 121 — modernizations. */
  async modernizations(tenantId: string, membershipId: string, organizationId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const docs = await this.prisma.fixedAssetDocument.findMany({ where: { tenantId, organizationId, documentType: FaDocumentType.MODERNIZATION }, include: { lines: true }, orderBy: { documentDate: 'asc' } });
    const assetIds = [...new Set(docs.flatMap((d) => d.lines.map((l) => l.assetId)))];
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, assetNumber: true, name: true, carryingAmount: true } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return docs.flatMap((d) =>
      d.lines.map((l) => ({
        documentId: d.id,
        number: d.number,
        date: isoDate(d.documentDate),
        kind: d.operationKind,
        reversed: !!d.reversedAt,
        assetId: l.assetId,
        assetNumber: byId.get(l.assetId)?.assetNumber,
        cipProjectId: d.cipProjectId,
        capitalizedCost: l.amount?.toString() ?? '0',
        usefulLifeBefore: l.usefulLifeBefore,
        usefulLifeAfter: l.usefulLifeAfter,
        nbvBefore: l.carryingAmountBefore?.toString(),
        nbvAfter: l.carryingAmountAfter?.toString(),
        currentNbv: byId.get(l.assetId)?.carryingAmount.toString(),
      })),
    );
  }

  /** Report 122 — disposals. */
  async disposals(tenantId: string, membershipId: string, organizationId: string, q: { from?: string; to?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const docs = await this.prisma.fixedAssetDocument.findMany({
      where: { tenantId, organizationId, documentType: FaDocumentType.DISPOSAL, ...(q.from || q.to ? { documentDate: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}) },
      include: { lines: true },
      orderBy: { documentDate: 'asc' },
    });
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: docs.flatMap((d) => d.lines.map((l) => l.assetId)) } }, select: { id: true, assetNumber: true, name: true } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return docs.flatMap((d) =>
      d.lines.map((l) => {
        const der = (l.details as any)?.derecognized ?? {};
        return {
          documentId: d.id,
          number: d.number,
          assetId: l.assetId,
          assetNumber: byId.get(l.assetId)?.assetNumber,
          assetName: byId.get(l.assetId)?.name,
          disposalDate: isoDate(d.documentDate),
          type: d.operationKind,
          share: l.share?.toString(),
          cost: der.cost ?? l.amount?.toString(),
          accumulatedDepreciation: der.accumulatedDepreciation,
          impairment: der.impairment,
          netBookValue: der.netBookValue,
          proceeds: l.proceeds?.toString(),
          disposalCosts: l.disposalCosts?.toString(),
          gainLoss: l.gainLoss?.toString(),
          salesInvoiceId: d.sourceDocumentType === 'SALES_INVOICE' ? d.sourceDocumentId : null,
          reversed: !!d.reversedAt,
        };
      }),
    );
  }

  /** Section 102 — book-tax difference preparation. */
  async bookTaxDifference(tenantId: string, membershipId: string, organizationId: string, q: { asOf?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const asOf = q.asOf ? toDate(q.asOf) : undefined;
    const assets = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, bookPolicies: { some: { bookCode: Books.TAX_BOOK, reversed: false } } }, orderBy: { assetNumber: 'asc' } });
    const out = [];
    for (const a of assets) {
      const acc = await this.ledger.balances(tenantId, a.id, { asOf });
      const tax = await this.ledger.balances(tenantId, a.id, { asOf, book: Books.TAX_BOOK });
      out.push({ assetId: a.id, assetNumber: a.assetNumber, name: a.name, accountingNbv: acc.netBookValue.toFixed(2), taxNbv: tax.netBookValue.toFixed(2), difference: acc.netBookValue.minus(tax.netBookValue).toFixed(2) });
    }
    return out;
  }

  /** Internal API getFixedAssetBalances(asOfDate) (spec section 144). */
  async getFixedAssetBalances(tenantId: string, organizationId: string, asOf: Date) {
    const agg = await this.prisma.fixedAssetMovement.aggregate({
      where: { tenantId, organizationId, bookCode: Books.ACCOUNTING_BOOK, businessDate: { lte: asOf } },
      _sum: { costIncrease: true, costDecrease: true, depreciationIncrease: true, depreciationDecrease: true, impairmentIncrease: true, impairmentDecrease: true, revaluationIncrease: true, revaluationDecrease: true },
    });
    const s = agg._sum;
    const cost = dec(s.costIncrease).minus(dec(s.costDecrease));
    const reval = dec(s.revaluationIncrease).minus(dec(s.revaluationDecrease));
    const dep = dec(s.depreciationIncrease).minus(dec(s.depreciationDecrease));
    const imp = dec(s.impairmentIncrease).minus(dec(s.impairmentDecrease));
    return { asOf: isoDate(asOf), grossCost: cost.plus(reval).toFixed(2), cost: cost.toFixed(2), revaluation: reval.toFixed(2), accumulatedDepreciation: dep.toFixed(2), impairment: imp.toFixed(2), netBookValue: cost.plus(reval).minus(dep).minus(imp).toFixed(2) };
  }

  /** Report 123 — Fixed Asset Health. */
  async health(tenantId: string, membershipId: string, organizationId: string, q: { asOf?: string; staleDays?: number }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const asOf = q.asOf ? toDate(q.asOf) : toDate(new Date());
    const staleDays = q.staleDays ?? 30;
    const staleBefore = addDays(asOf, -staleDays);
    const checks: { code: string; severity: 'ERROR' | 'WARNING'; count: number; items: unknown[] }[] = [];
    const push = (code: string, severity: 'ERROR' | 'WARNING', items: unknown[]) => checks.push({ code, severity, count: items.length, items });

    push('CANDIDATE_UNPROCESSED_TOO_LONG', 'WARNING', await this.prisma.fixedAssetAcquisitionCandidate.findMany({ where: { tenantId, organizationId, status: { in: CANDIDATE_PENDING_STATUSES }, sourceDate: { lt: staleBefore } }, select: { id: true, number: true, description: true, sourceDate: true, capitalizableAmount: true } }));
    const staleCip = await this.prisma.capitalInvestmentProject.findMany({ where: { tenantId, organizationId, status: { in: ['ACTIVE', 'PLANNED', 'SUSPENDED', 'READY_FOR_CAPITALIZATION'] }, OR: [{ plannedCompletionDate: { lt: asOf } }, { startDate: { lt: addDays(asOf, -365) } }] }, select: { id: true, code: true, name: true, startDate: true, plannedCompletionDate: true } });
    push('CIP_STALE', 'WARNING', staleCip);
    push('ACCEPTED_NOT_COMMISSIONED', 'WARNING', await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { in: [AssetStatus.ACCEPTED, AssetStatus.NOT_COMMISSIONED] }, acceptanceDate: { lt: staleBefore } }, select: { id: true, assetNumber: true, name: true, acceptanceDate: true } }));

    const inUse = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { in: IN_USE_STATUSES } }, select: { id: true, assetNumber: true, name: true, responsiblePersonId: true, locationId: true, usefulLifeMonths: true, status: true } });
    const noSettings = [];
    for (const a of inUse) {
      const bp = await this.policies.latestBookPolicy(tenantId, a.id, Books.ACCOUNTING_BOOK);
      if (!bp || !bp.usefulLifeMonths) noSettings.push({ id: a.id, assetNumber: a.assetNumber });
    }
    push('COMMISSIONED_WITHOUT_DEPRECIATION_SETTINGS', 'ERROR', noSettings);
    const recognized = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { in: RECOGNIZED_STATUSES } }, select: { id: true, assetNumber: true, responsiblePersonId: true, locationId: true } });
    push('MISSING_RESPONSIBLE_PERSON', 'WARNING', recognized.filter((a) => !a.responsiblePersonId).map((a) => ({ id: a.id, assetNumber: a.assetNumber })));
    push('MISSING_LOCATION', 'WARNING', recognized.filter((a) => !a.locationId).map((a) => ({ id: a.id, assetNumber: a.assetNumber })));

    push('DEPRECIATION_ERROR', 'ERROR', await this.prisma.fixedAssetDepreciationLine.findMany({ where: { tenantId, status: 'ERROR', run: { organizationId, status: { in: ['CALCULATED', 'POSTED'] } } }, select: { assetId: true, period: true, errorCode: true, errorMessage: true } }));
    const dup = await this.prisma.fixedAssetDepreciationLine.groupBy({ by: ['assetId', 'bookCode', 'period'], where: { tenantId, status: 'POSTED', run: { organizationId } }, _count: { _all: true } });
    push('DUPLICATED_DEPRECIATION', 'ERROR', dup.filter((d) => d._count._all > 1));

    const negative = [];
    const fullyStillDepreciating = [];
    for (const a of await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { notIn: ['ACQUISITION', 'CANCELLED'] } }, select: { id: true, assetNumber: true } })) {
      const b = await this.ledger.balances(tenantId, a.id);
      if (b.netBookValue.lt(0)) negative.push({ id: a.id, assetNumber: a.assetNumber, netBookValue: b.netBookValue.toFixed(2) });
    }
    const overLines = await this.prisma.fixedAssetDepreciationLine.findMany({ where: { tenantId, status: 'POSTED', run: { organizationId } }, select: { assetId: true, period: true, openingNbv: true, residualValue: true, depreciationAmount: true } });
    for (const l of overLines) if (dec(l.openingNbv).lte(dec(l.residualValue)) && dec(l.depreciationAmount).gt(0)) fullyStillDepreciating.push(l);
    push('NEGATIVE_NBV', 'ERROR', negative);
    push('FULLY_DEPRECIATED_STILL_DEPRECIATING', 'ERROR', fullyStillDepreciating);

    const statusIssues = await this.reconciliation.reconcileAssetStatus(tenantId, organizationId);
    push('DISPOSED_ASSET_STILL_ACTIVE', 'ERROR', statusIssues.filter((i) => i.issue === 'DISPOSED_ASSET_STILL_ACTIVE'));
    const disposalIssues = await this.reconciliation.validateDisposals(tenantId, organizationId);
    push('DISPOSED_WITH_RESIDUAL_BALANCE', 'ERROR', disposalIssues.filter((i) => i.issue === 'DISPOSED_WITH_RESIDUAL_BALANCE'));
    push('DISPOSED_ASSET_STILL_DEPRECIATING', 'ERROR', disposalIssues.filter((i) => i.issue === 'DISPOSED_ASSET_STILL_DEPRECIATING'));

    const recon = await this.reconciliation.reconcile(tenantId, organizationId, asOf);
    push('GL_MISMATCH', 'ERROR', recon.lines.filter((l) => !l.healthy));
    push('ASSET_INVENTORY_MISMATCH', 'WARNING', await this.prisma.fixedAssetInventoryResult.findMany({ where: { tenantId, count: { organizationId }, result: { notIn: [InventoryResult.FOUND, InventoryResult.PENDING] }, resolutionStatus: { not: 'RESOLVED' } }, select: { id: true, assetId: true, result: true, resolutionStatus: true } }));
    const pendingMod = await this.prisma.fixedAssetCostComponent.findMany({ where: { tenantId, purpose: 'MODERNIZATION', recognized: false, released: false, asset: { organizationId } }, select: { assetId: true, amount: true, candidateId: true } });
    const underMod = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: AssetStatus.UNDER_MODERNIZATION }, select: { id: true, assetNumber: true } });
    push('MODERNIZATION_NOT_CAPITALIZED', 'WARNING', [...pendingMod, ...underMod]);
    const closedProjects = await this.prisma.capitalInvestmentProject.findMany({ where: { tenantId, organizationId, status: { in: ['CAPITALIZED', 'CANCELLED'] } }, include: { costs: true } });
    push('CIP_RESIDUAL_AFTER_CLOSURE', 'ERROR', closedProjects.map((p) => ({ id: p.id, code: p.code, residual: p.costs.reduce((s, c) => s.plus(dec(c.amount)), new Decimal(0)).toFixed(2) })).filter((p) => p.residual !== '0.00'));
    push('PROJECTION_DRIFT', 'WARNING', statusIssues.filter((i) => i.issue === 'PROJECTION_DRIFT'));

    return { asOf: isoDate(asOf), healthy: checks.every((c) => c.severity !== 'ERROR' || c.count === 0), checks, reconciliation: recon };
  }
}
