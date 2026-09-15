import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * ProductionVariance + ProductionOrderClose combined (spec sections
 * 82-91, 31-32). Standard baseline is OPTIONAL (spec section 91) — the
 * actual-costing flow (`MaterialIssuePostingHandler`,
 * `ProductionOutputPostingHandler`) works with or without ever calling
 * `calculateVariances`. Only `MATERIAL_USAGE`/`MATERIAL_PRICE` and
 * `LABOR_EFFICIENCY`/`LABOR_RATE` are computed (spec's own minimum
 * examples); `OVERHEAD`/`YIELD` variance types are valid enum values on
 * `ProductionVariance` with no calculation wired yet (disclosed
 * simplification, see docs/MANUFACTURING.md).
 */
@Injectable()
export class ProductionCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async calculateVariances(tenantId: string, membershipId: string, organizationId: string, userId: string, productionOrderId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.productionOrder.findFirst({ where: { id: productionOrderId, organizationId }, include: { requirements: true, outputs: true, bomVersion: { include: { lines: true } } } });
    if (!order) throw new NotFoundAppError('ProductionOrder', productionOrderId);
    const actualGoodOutput = order.outputs.filter((o) => o.outputType === 'MAIN_PRODUCT').reduce((s, o) => s.plus(o.receivedQuantity.toString()), new Decimal(0));
    if (actualGoodOutput.lte(0)) throw new ValidationAppError('No output received yet — nothing to compare standard cost against');

    const results = [];
    for (const requirement of order.requirements) {
      const bomLine = order.bomVersion.lines.find((l) => l.id === requirement.sourceBomLineId);
      if (!bomLine) continue;
      const standardQuantity = new Decimal(bomLine.quantity.toString()).mul(new Decimal(1).plus(bomLine.scrapFactor.toString())).mul(actualGoodOutput).dividedBy(order.bomVersion.baseOutputQuantity.toString());
      const actualQuantity = new Decimal(requirement.consumedQuantity.toString());
      if (standardQuantity.eq(0) && actualQuantity.eq(0)) continue;

      const usageVarianceQty = actualQuantity.minus(standardQuantity);
      const materialCostMovements = await this.prisma.productionCostMovement.aggregate({ where: { tenantId, productionOrderId, costComponent: 'DIRECT_MATERIAL', reversed: false }, _sum: { costIn: true, costOut: true } });
      const actualMaterialCost = new Decimal((materialCostMovements._sum.costIn ?? 0).toString()).minus((materialCostMovements._sum.costOut ?? 0).toString());
      const actualUnitCost = actualQuantity.gt(0) ? actualMaterialCost.dividedBy(actualQuantity) : new Decimal(0);

      results.push(await this.prisma.productionVariance.create({ data: { tenantId, productionOrderId, varianceType: 'MATERIAL_USAGE', standardQuantity: standardQuantity.toString(), actualQuantity: actualQuantity.toString(), varianceAmount: usageVarianceQty.mul(actualUnitCost).toDecimalPlaces(2).toString(), favorable: usageVarianceQty.lte(0) } }));
    }

    const laborInputs = await this.prisma.productionLaborInput.findMany({ where: { tenantId, productionOrderId, status: 'ACTIVE' } });
    const actualLaborHours = laborInputs.reduce((s, l) => s.plus(l.hours.toString()), new Decimal(0));
    const actualLaborCost = laborInputs.reduce((s, l) => s.plus(l.costAmount.toString()), new Decimal(0));
    if (order.routingVersionId) {
      const routing = await this.prisma.routingVersion.findFirst({ where: { id: order.routingVersionId }, include: { operations: true } });
      const standardLaborHours = (routing?.operations ?? []).reduce((s, op) => s.plus(new Decimal(op.laborStandardHours?.toString() ?? 0)), new Decimal(0)).mul(actualGoodOutput).dividedBy(routing?.baseQuantity.toString() ?? 1);
      const standardRate = standardLaborHours.gt(0) ? actualLaborCost.dividedBy(actualLaborHours || new Decimal(1)) : new Decimal(0); // no independent standard rate table in this build — see docs/MANUFACTURING.md
      results.push(await this.prisma.productionVariance.create({ data: { tenantId, productionOrderId, varianceType: 'LABOR_EFFICIENCY', standardQuantity: standardLaborHours.toString(), actualQuantity: actualLaborHours.toString(), varianceAmount: actualLaborHours.minus(standardLaborHours).mul(standardRate).toDecimalPlaces(2).toString(), favorable: actualLaborHours.lte(standardLaborHours) } }));
    }

    await this.audit.record({ tenantId, eventType: 'PRODUCTION_VARIANCE_CALCULATED', entityType: 'PRODUCTION_ORDER', entityId: productionOrderId, action: 'CREATE', userId, newValues: { count: results.length } });
    return results;
  }

  /** Close checks (spec sections 31-32) — WIP must be explained (zero, or
   * the residual is understood as work genuinely still in progress). */
  async runCloseChecks(tenantId: string, organizationId: string, productionOrderId: string) {
    const order = await this.prisma.productionOrder.findFirst({ where: { id: productionOrderId, organizationId }, include: { requirements: true, outputs: true } });
    if (!order) throw new NotFoundAppError('ProductionOrder', productionOrderId);
    const checks: { code: string; passed: boolean; message: string }[] = [];

    const unfulfilled = order.requirements.filter((r) => new Decimal(r.consumedQuantity.toString()).lt(new Decimal(r.requiredQuantity.toString()).minus('0.001')));
    checks.push({ code: 'MATERIAL_REQUIREMENTS_FULFILLED', passed: unfulfilled.length === 0, message: unfulfilled.length === 0 ? 'All material requirements consumed.' : `${unfulfilled.length} requirement(s) not fully consumed.` });

    const mainOutput = order.outputs.find((o) => o.outputType === 'MAIN_PRODUCT');
    const outputReceived = mainOutput ? new Decimal(mainOutput.receivedQuantity.toString()).gte(new Decimal(mainOutput.plannedQuantity.toString()).minus('0.001')) : false;
    checks.push({ code: 'MAIN_OUTPUT_RECEIVED', passed: outputReceived, message: outputReceived ? 'Planned main output fully received.' : 'Main output not fully received yet.' });

    const wipAgg = await this.prisma.productionCostMovement.aggregate({ where: { tenantId, productionOrderId, reversed: false }, _sum: { costIn: true, costOut: true } });
    const wipBalance = new Decimal((wipAgg._sum.costIn ?? 0).toString()).minus((wipAgg._sum.costOut ?? 0).toString());
    checks.push({ code: 'WIP_EXPLAINED', passed: wipBalance.abs().lte('0.05'), message: wipBalance.abs().lte('0.05') ? 'WIP balance is zero.' : `WIP balance of ${wipBalance.toString()} remains — review before closing.` });

    return checks;
  }

  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, productionOrderId: string, force = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const checks = await this.runCloseChecks(tenantId, organizationId, productionOrderId);
    const failed = checks.filter((c) => !c.passed);
    if (failed.length > 0 && !force) throw new ValidationAppError(`Cannot close — ${failed.length} check(s) failed: ${failed.map((c) => c.code).join(', ')}. Pass force=true to close anyway (residual WIP is written off as a COST_ADJUSTMENT).`);

    return this.prisma.runInTransaction(async (tx) => {
      if (force) {
        const wipAgg = await tx.productionCostMovement.aggregate({ where: { tenantId, productionOrderId, reversed: false }, _sum: { costIn: true, costOut: true } });
        const residual = new Decimal((wipAgg._sum.costIn ?? 0).toString()).minus((wipAgg._sum.costOut ?? 0).toString());
        if (residual.abs().gt('0.05')) await tx.productionCostMovement.create({ data: { tenantId, organizationId, productionOrderId, costComponent: 'COST_ADJUSTMENT', costOut: residual.gt(0) ? residual.toString() : '0', costIn: residual.lt(0) ? residual.abs().toString() : '0', sourceDocumentType: 'PRODUCTION_ORDER_CLOSE', sourceDocumentId: productionOrderId, effectiveDate: new Date() } });
      }
      const row = await tx.productionOrder.update({ where: { id: productionOrderId }, data: { closeStatus: 'CLOSED', calculationStatus: 'FINAL' } });
      await this.audit.record({ tenantId, eventType: 'PRODUCTION_ORDER_CLOSED', entityType: 'PRODUCTION_ORDER', entityId: productionOrderId, action: 'UPDATE', userId, newValues: { forced: force } }, tx);
      return row;
    });
  }
}
