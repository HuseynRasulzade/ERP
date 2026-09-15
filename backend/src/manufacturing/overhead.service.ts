import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const OVERHEAD_SOURCE_TYPE = 'PRODUCTION_OVERHEAD_POOL';

/**
 * OverheadService (spec sections 92-94). The pool amount is expected to
 * originate from Phase 20's own cost centers/expense allocations (spec
 * section 92) — this build does not automatically pull that number in;
 * `createPool` takes it as an input (disclosed simplification, see
 * docs/MANUFACTURING.md). `allocate` spreads the pool across every OPEN
 * production order active in the period, weighted by `driverType`
 * (`DIRECT_LABOR_HOURS`/`MACHINE_HOURS` read from this order's own
 * `ProductionLaborInput`/`MachineTimeInput`; `DIRECT_MATERIAL_COST` from
 * its `ProductionCostMovement` DIRECT_MATERIAL rows; `UNITS_PRODUCED`
 * from its output receipts) — Dr WORK_IN_PROGRESS / Cr
 * PRODUCTION_OVERHEAD_APPLIED per order.
 */
@Injectable()
export class OverheadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly postingEngine: AccountingPostingEngine,
  ) {}

  async createPool(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { period: string; costCenterId?: string; workCenterGroupCode?: string; costType?: string; amount: number; driverType?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.productionOverheadPool.create({ data: { tenantId, organizationId, period: new Date(dto.period), costCenterId: dto.costCenterId, workCenterGroupCode: dto.workCenterGroupCode, costType: dto.costType ?? 'OTHER', amount: dto.amount.toString(), driverType: dto.driverType ?? 'DIRECT_LABOR_HOURS', createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'PRODUCTION_OVERHEAD_POOL_CREATED', entityType: OVERHEAD_SOURCE_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async allocate(tenantId: string, membershipId: string, organizationId: string, userId: string, poolId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const pool = await this.prisma.productionOverheadPool.findFirst({ where: { id: poolId, tenantId, organizationId } });
    if (!pool) throw new NotFoundAppError('ProductionOverheadPool', poolId);
    if (pool.status === 'ALLOCATED') throw new ValidationAppError('Pool is already allocated');
    const periodStart = new Date(pool.period);
    const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);

    const orders = await this.prisma.productionOrder.findMany({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] }, documentDate: { lte: periodEnd } } });
    const driverValues = new Map<string, Decimal>();
    for (const order of orders) {
      let value = new Decimal(0);
      if (pool.driverType === 'DIRECT_LABOR_HOURS') { const agg = await this.prisma.productionLaborInput.aggregate({ where: { tenantId, productionOrderId: order.id, workDate: { gte: periodStart, lte: periodEnd }, status: 'ACTIVE' }, _sum: { hours: true } }); value = new Decimal((agg._sum.hours ?? 0).toString()); }
      else if (pool.driverType === 'MACHINE_HOURS') { const agg = await this.prisma.machineTimeInput.aggregate({ where: { tenantId, productionOrderId: order.id, workDate: { gte: periodStart, lte: periodEnd }, status: 'ACTIVE' }, _sum: { hours: true } }); value = new Decimal((agg._sum.hours ?? 0).toString()); }
      else if (pool.driverType === 'DIRECT_MATERIAL_COST') { const agg = await this.prisma.productionCostMovement.aggregate({ where: { tenantId, productionOrderId: order.id, costComponent: 'DIRECT_MATERIAL', effectiveDate: { gte: periodStart, lte: periodEnd }, reversed: false }, _sum: { costIn: true } }); value = new Decimal((agg._sum.costIn ?? 0).toString()); }
      else { const agg = await this.prisma.productionOutputReceipt.aggregate({ where: { tenantId, organizationId, productionOrderId: order.id, documentDate: { gte: periodStart, lte: periodEnd }, postingStatus: 'POSTED' }, _sum: { goodQuantity: true } }); value = new Decimal((agg._sum.goodQuantity ?? 0).toString()); }
      if (value.gt(0)) driverValues.set(order.id, value);
    }

    const totalDriver = [...driverValues.values()].reduce((s, v) => s.plus(v), new Decimal(0));
    if (totalDriver.lte(0)) throw new ValidationAppError(`No driver activity (${pool.driverType}) found for any production order in period ${pool.period.toISOString().slice(0, 7)} — cannot allocate.`);

    const wipAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.WORK_IN_PROGRESS, periodEnd).catch(() => null);
    const appliedAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.PRODUCTION_OVERHEAD_APPLIED, periodEnd).catch(() => null);
    const totalAmount = new Decimal(pool.amount.toString());

    return this.prisma.runInTransaction(async (tx) => {
      let allocated = new Decimal(0);
      const entries = [...driverValues.entries()];
      for (let i = 0; i < entries.length; i++) {
        const [orderId, value] = entries[i];
        const isLast = i === entries.length - 1;
        const share = isLast ? totalAmount.minus(allocated) : totalAmount.mul(value).dividedBy(totalDriver).toDecimalPlaces(2);
        allocated = allocated.plus(share);
        if (share.lte(0)) continue;

        await tx.productionCostMovement.create({ data: { tenantId, organizationId, productionOrderId: orderId, costComponent: 'PRODUCTION_OVERHEAD', costIn: share.toString(), sourceDocumentType: OVERHEAD_SOURCE_TYPE, sourceDocumentId: pool.id, effectiveDate: periodEnd } });
        if (wipAccount && appliedAccount) {
          await this.postingEngine.postBatch(tenantId, userId, { organizationId, businessDate: periodEnd, description: `Overhead applied — order ${orderId}`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: OVERHEAD_SOURCE_TYPE, sourceDocumentId: `${pool.id}:${orderId}`, lines: [{ accountId: wipAccount.id, side: 'DEBIT', amountBase: share, dimensions: [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: orderId }] }, { accountId: appliedAccount.id, side: 'CREDIT', amountBase: share, dimensions: [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: orderId }] }] }, tx);
        }
      }
      const updated = await tx.productionOverheadPool.update({ where: { id: poolId }, data: { allocatedAmount: allocated.toString(), status: 'ALLOCATED' } });
      await this.audit.record({ tenantId, eventType: 'PRODUCTION_OVERHEAD_ALLOCATED', entityType: OVERHEAD_SOURCE_TYPE, entityId: poolId, action: 'UPDATE', userId, newValues: { allocated: allocated.toString(), orderCount: entries.length } }, tx);
      return updated;
    });
  }

  list(tenantId: string, organizationId: string) {
    return this.prisma.productionOverheadPool.findMany({ where: { tenantId, organizationId }, orderBy: { period: 'desc' } });
  }
}
