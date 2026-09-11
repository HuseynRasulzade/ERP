import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, SupplyPegExceedsDemandError, ValidationAppError } from '../common/errors/app-error';
import { CreateSupplyPegDto } from './dto/procurement.dto';

/**
 * SupplyPeg (spec sections 73-77). Planning linkage between a demand line
 * (today: a SalesOrderLine — this build's CustomerOrderLine) and a supply
 * line (today: a PurchaseOrderLine) — NEVER a physical reservation
 * (`StockReservation` stays untouched by this service, spec section 75).
 * Made-to-order procurement (spec section 76) creates the peg when the
 * PurchaseOrder is raised for a specific customer demand; stock
 * replenishment procurement (spec section 77) simply never calls this —
 * not every PurchaseOrderLine needs a peg.
 */
@Injectable()
export class SupplyPegService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  listForDemand(tenantId: string, demandType: string, demandId: string, demandLineId: string) {
    return this.prisma.supplyPeg.findMany({ where: { tenantId, demandType, demandId, demandLineId, status: 'ACTIVE' } });
  }

  listForSupply(tenantId: string, supplyType: string, supplyId: string, supplyLineId: string) {
    return this.prisma.supplyPeg.findMany({ where: { tenantId, supplyType, supplyId, supplyLineId, status: 'ACTIVE' } });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateSupplyPegDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const quantity = new Decimal(dto.quantity.toString());
    if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationAppError('Peg quantity must be positive');

    // Demand-side validation: only SalesOrderLine demand is wired up today
    // (spec section 76's made-to-order flow); other demand types are
    // schema-ready (generic string columns) but unimplemented here.
    if (dto.demandType === 'SALES_ORDER') {
      const demandLine = await this.prisma.salesOrderLine.findFirst({ where: { id: dto.demandLineId, tenantId, salesOrderId: dto.demandId } });
      if (!demandLine) throw new NotFoundAppError('SalesOrderLine', dto.demandLineId);

      const existingPegs = await this.listForDemand(tenantId, dto.demandType, dto.demandId, dto.demandLineId);
      const alreadyPegged = existingPegs.reduce((s, p) => s.plus(p.quantity.toString()), new Decimal(0));
      const remaining = new Decimal(demandLine.quantity.toString()).minus(demandLine.cancelledQuantity.toString()).minus(alreadyPegged);
      if (quantity.gt(remaining)) throw new SupplyPegExceedsDemandError(remaining.toString(), quantity.toString());
    }

    if (dto.supplyType === 'PURCHASE_ORDER') {
      const supplyLine = await this.prisma.purchaseOrderLine.findFirst({ where: { id: dto.supplyLineId, tenantId, purchaseOrderId: dto.supplyId } });
      if (!supplyLine) throw new NotFoundAppError('PurchaseOrderLine', dto.supplyLineId);
    }

    const peg = await this.prisma.supplyPeg.create({
      data: {
        tenantId,
        demandType: dto.demandType,
        demandId: dto.demandId,
        demandLineId: dto.demandLineId,
        supplyType: dto.supplyType,
        supplyId: dto.supplyId,
        supplyLineId: dto.supplyLineId,
        quantity: quantity.toString(),
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'SUPPLY_PEG_CREATED', entityType: 'SupplyPeg', entityId: peg.id, action: 'CREATE', userId, newValues: { ...dto } });
    return peg;
  }

  async remove(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const peg = await this.prisma.supplyPeg.findFirst({ where: { id, tenantId } });
    if (!peg) throw new NotFoundAppError('SupplyPeg', id);
    if (peg.status !== 'ACTIVE') throw new ValidationAppError('Peg is already removed');

    const updated = await this.prisma.supplyPeg.update({ where: { id }, data: { status: 'REMOVED' } });
    await this.audit.record({ tenantId, eventType: 'SUPPLY_PEG_REMOVED', entityType: 'SupplyPeg', entityId: id, action: 'UPDATE', userId });
    return updated;
  }
}
