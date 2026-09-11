import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { ADDITIONAL_PURCHASE_COST_TYPE } from './additional-purchase-cost.repository';
import { CreateAdditionalPurchaseCostDto } from './dto/purchase-execution.dto';

const SEQUENCE_PREFIX = 'APC';
const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];

@Injectable()
export class AdditionalPurchaseCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.additionalPurchaseCost.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.additionalPurchaseCost.findFirst({ where: { id, organizationId }, include: { targetLines: true, allocations: true } });
    if (!row) throw new NotFoundAppError('AdditionalPurchaseCost', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateAdditionalPurchaseCostDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const supplier = await this.prisma.counterparty.findFirst({ where: { id: dto.counterpartyId, organizationId, tenantId } });
    if (!supplier) throw new ValidationAppError('Counterparty does not belong to this organization');
    if (!SUPPLIER_TYPES.includes(supplier.counterpartyType)) throw new ValidationAppError('Counterparty does not have the SUPPLIER role');

    for (const target of dto.targetLines) {
      const grLine = await this.prisma.goodsReceiptLine.findFirst({ where: { id: target.goodsReceiptLineId, tenantId } });
      if (!grLine) throw new ValidationAppError(`Goods receipt line not found: ${target.goodsReceiptLineId}`);
      if (dto.allocationMethod === 'MANUAL' && (target.manualCoefficient === undefined || target.manualCoefficient <= 0)) {
        throw new ValidationAppError('Every target line needs a positive manual coefficient for MANUAL allocation');
      }
    }

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, ADDITIONAL_PURCHASE_COST_TYPE, businessDate, tx);

      const header = await tx.additionalPurchaseCost.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          number: allocated.formatted,
          documentDate: businessDate,
          currencyId: dto.currencyId,
          costType: dto.costType ?? 'OTHER',
          allocationMethod: dto.allocationMethod,
          totalCost: dto.totalCost.toString(),
          taxRate: (dto.taxRate ?? 0).toString(),
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const target of dto.targetLines) {
        await tx.additionalPurchaseCostLine.create({
          data: { tenantId, additionalPurchaseCostId: header.id, goodsReceiptLineId: target.goodsReceiptLineId, manualCoefficient: target.manualCoefficient?.toString() },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'ADDITIONAL_COST_CREATED', entityType: ADDITIONAL_PURCHASE_COST_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, totalCost: dto.totalCost, allocationMethod: dto.allocationMethod } },
        tx,
      );

      return tx.additionalPurchaseCost.findFirst({ where: { id: header.id }, include: { targetLines: true } });
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: ADDITIONAL_PURCHASE_COST_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: ADDITIONAL_PURCHASE_COST_TYPE, documentType: ADDITIONAL_PURCHASE_COST_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
