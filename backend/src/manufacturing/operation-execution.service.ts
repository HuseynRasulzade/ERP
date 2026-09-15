import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const LABOR_SOURCE_TYPE = 'PRODUCTION_LABOR_INPUT';
const MACHINE_SOURCE_TYPE = 'PRODUCTION_MACHINE_TIME';
const SCRAP_SOURCE_TYPE = 'PRODUCTION_SCRAP';

/**
 * OperationExecutionService + labor/machine/scrap inputs combined (spec
 * sections 48-59, 74-77). Each posts its own `ProductionCostMovement`
 * (`DIRECT_LABOR`/`MACHINE`/`SCRAP_LOSS`) plus a real GL entry — Dr
 * WORK_IN_PROGRESS / Cr the labor/machine/scrap source account — the
 * moment it's recorded, not batched at order close. `costMethod:
 * 'STANDARD_PROVISIONAL'` uses a caller-supplied rate (spec section 57 —
 * Phase 19 payroll cost integration for `ACTUAL_PAYROLL_COST` is NOT
 * wired end-to-end in this build, disclosed simplification, see
 * docs/MANUFACTURING.md).
 */
@Injectable()
export class OperationExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly postingEngine: AccountingPostingEngine,
  ) {}

  /** Cumulative progress (spec section 50) — each call adds to, never
   * replaces, the order's own executed quantities. */
  async recordExecution(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { productionOrderId: string; routingOperationId?: string; workCenterId: string; executionDate: string; goodQuantity?: number; scrapQuantity?: number; reworkQuantity?: number; laborHours?: number; machineHours?: number; status?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.productionOrder.findFirst({ where: { id: dto.productionOrderId, organizationId } });
    if (!order) throw new NotFoundAppError('ProductionOrder', dto.productionOrderId);
    const row = await this.prisma.operationExecution.create({ data: { tenantId, productionOrderId: dto.productionOrderId, routingOperationId: dto.routingOperationId, workCenterId: dto.workCenterId, executionDate: new Date(dto.executionDate), startedAt: new Date(), goodQuantity: (dto.goodQuantity ?? 0).toString(), scrapQuantity: (dto.scrapQuantity ?? 0).toString(), reworkQuantity: (dto.reworkQuantity ?? 0).toString(), laborHours: (dto.laborHours ?? 0).toString(), machineHours: (dto.machineHours ?? 0).toString(), status: dto.status ?? 'PARTIALLY_COMPLETED', createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'PRODUCTION_OPERATION_EXECUTED', entityType: 'OPERATION_EXECUTION', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async recordLabor(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { productionOrderId: string; routingOperationId?: string; employmentId?: string; workDate: string; hours: number; hourlyRate: number; costMethod?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.productionOrder.findFirst({ where: { id: dto.productionOrderId, organizationId } });
    if (!order) throw new NotFoundAppError('ProductionOrder', dto.productionOrderId);
    const costAmount = new Decimal(dto.hours).mul(dto.hourlyRate);
    const businessDate = new Date(dto.workDate);

    return this.prisma.runInTransaction(async (tx) => {
      const input = await tx.productionLaborInput.create({ data: { tenantId, productionOrderId: dto.productionOrderId, routingOperationId: dto.routingOperationId, employmentId: dto.employmentId, workDate: businessDate, hours: dto.hours.toString(), hourlyRate: dto.hourlyRate.toString(), costAmount: costAmount.toString(), costMethod: dto.costMethod ?? 'STANDARD_PROVISIONAL', createdBy: userId } });
      await tx.productionCostMovement.create({ data: { tenantId, organizationId, productionOrderId: dto.productionOrderId, costComponent: 'DIRECT_LABOR', costIn: costAmount.toString(), sourceDocumentType: LABOR_SOURCE_TYPE, sourceDocumentId: input.id, effectiveDate: businessDate } });
      await this.postWipEntry(tenantId, organizationId, businessDate, costAmount, MappingKeys.ADMIN_EXPENSE, `Direct labor — production order ${dto.productionOrderId}`, dto.productionOrderId, LABOR_SOURCE_TYPE, input.id, userId, tx);
      await this.audit.record({ tenantId, eventType: 'PRODUCTION_LABOR_RECORDED', entityType: LABOR_SOURCE_TYPE, entityId: input.id, action: 'CREATE', userId, newValues: { hours: dto.hours, costAmount: costAmount.toString() } }, tx);
      return input;
    });
  }

  async recordMachineTime(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { productionOrderId: string; routingOperationId?: string; workCenterId: string; workDate: string; hours: number; rate?: number }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const workCenter = await this.prisma.workCenter.findFirst({ where: { id: dto.workCenterId, tenantId } });
    if (!workCenter) throw new NotFoundAppError('WorkCenter', dto.workCenterId);
    const rate = new Decimal(dto.rate ?? workCenter.hourlyMachineRate?.toString() ?? 0);
    if (rate.lte(0)) throw new ValidationAppError('No machine rate configured — pass one explicitly or set WorkCenter.hourlyMachineRate');
    const costAmount = new Decimal(dto.hours).mul(rate);
    const businessDate = new Date(dto.workDate);

    return this.prisma.runInTransaction(async (tx) => {
      const input = await tx.machineTimeInput.create({ data: { tenantId, productionOrderId: dto.productionOrderId, routingOperationId: dto.routingOperationId, workCenterId: dto.workCenterId, workDate: businessDate, hours: dto.hours.toString(), rate: rate.toString(), costAmount: costAmount.toString() } });
      await tx.productionCostMovement.create({ data: { tenantId, organizationId, productionOrderId: dto.productionOrderId, costComponent: 'MACHINE', costIn: costAmount.toString(), sourceDocumentType: MACHINE_SOURCE_TYPE, sourceDocumentId: input.id, effectiveDate: businessDate } });
      await this.postWipEntry(tenantId, organizationId, businessDate, costAmount, MappingKeys.OTHER_OPERATING_EXPENSE, `Machine time — production order ${dto.productionOrderId}`, dto.productionOrderId, MACHINE_SOURCE_TYPE, input.id, userId, tx);
      await this.audit.record({ tenantId, eventType: 'PRODUCTION_MACHINE_TIME_RECORDED', entityType: MACHINE_SOURCE_TYPE, entityId: input.id, action: 'CREATE', userId, newValues: { hours: dto.hours, costAmount: costAmount.toString() } }, tx);
      return input;
    });
  }

  /** Scrap recorded where it occurs (spec section 52), never deferred to
   * final output. `ABNORMAL_SCRAP` moves its cost OUT of WIP into a loss
   * expense (spec section 77); `NORMAL_PROCESS_SCRAP` stays in WIP (it is
   * already priced into the good output's own standard/actual cost). */
  async recordScrap(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { productionOrderId: string; operationExecutionId?: string; productId: string; scrapType: string; quantity: number; unitId: string; valuationPolicy?: string; referenceValue?: number; recordDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.scrapRecord.create({ data: { tenantId, productionOrderId: dto.productionOrderId, operationExecutionId: dto.operationExecutionId, productId: dto.productId, scrapType: dto.scrapType, quantity: dto.quantity.toString(), unitId: dto.unitId, valuationPolicy: dto.valuationPolicy ?? 'ZERO', referenceValue: dto.referenceValue?.toString(), recordDate: new Date(dto.recordDate), createdBy: userId } });

    if (dto.scrapType === 'ABNORMAL_SCRAP' && dto.referenceValue) {
      const businessDate = new Date(dto.recordDate);
      const amount = new Decimal(dto.referenceValue).mul(dto.quantity);
      await this.prisma.runInTransaction(async (tx) => {
        await tx.productionCostMovement.create({ data: { tenantId, organizationId, productionOrderId: dto.productionOrderId, costComponent: 'SCRAP_LOSS', costOut: amount.toString(), quantityOut: dto.quantity.toString(), sourceDocumentType: SCRAP_SOURCE_TYPE, sourceDocumentId: row.id, effectiveDate: businessDate } });
        const wipAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.WORK_IN_PROGRESS, businessDate, tx).catch(() => null);
        const lossAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SCRAP_LOSS_EXPENSE, businessDate, tx).catch(() => null);
        if (wipAccount && lossAccount) {
          await this.postingEngine.postBatch(tenantId, userId, { organizationId, businessDate, description: `Abnormal scrap — production order ${dto.productionOrderId}`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: SCRAP_SOURCE_TYPE, sourceDocumentId: row.id, lines: [{ accountId: lossAccount.id, side: 'DEBIT', amountBase: amount, dimensions: [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: dto.productionOrderId }] }, { accountId: wipAccount.id, side: 'CREDIT', amountBase: amount, dimensions: [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: dto.productionOrderId }] }] }, tx);
        }
      });
    }
    await this.audit.record({ tenantId, eventType: 'PRODUCTION_SCRAP_RECORDED', entityType: SCRAP_SOURCE_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  private async postWipEntry(tenantId: string, organizationId: string, businessDate: Date, amount: Decimal, creditMappingKey: string, description: string, productionOrderId: string, sourceDocumentType: string, sourceDocumentId: string, userId: string, tx: any) {
    if (amount.lte(0)) return;
    const wipAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.WORK_IN_PROGRESS, businessDate, tx).catch(() => null);
    const creditAccount = await this.mappings.resolve(tenantId, organizationId, creditMappingKey, businessDate, tx).catch(() => null);
    if (!wipAccount || !creditAccount) return;
    await this.postingEngine.postBatch(tenantId, userId, { organizationId, businessDate, description, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType, sourceDocumentId, lines: [{ accountId: wipAccount.id, side: 'DEBIT', amountBase: amount, dimensions: [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: productionOrderId }] }, { accountId: creditAccount.id, side: 'CREDIT', amountBase: amount, dimensions: [{ dimensionCode: 'PRODUCTION_ORDER', referenceId: productionOrderId }] }] }, tx);
  }

  list(tenantId: string, productionOrderId: string) {
    return this.prisma.operationExecution.findMany({ where: { tenantId, productionOrderId }, orderBy: { executionDate: 'asc' } });
  }
}
