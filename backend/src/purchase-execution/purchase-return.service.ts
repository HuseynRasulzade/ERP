import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, PurchaseReturnSourceRequiredError, ValidationAppError } from '../common/errors/app-error';
import { PURCHASE_RETURN_TYPE } from './purchase-return.repository';
import { CreatePurchaseReturnDto } from './dto/purchase-execution.dto';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';

const SEQUENCE_PREFIX = 'PRTN';
const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];

@Injectable()
export class PurchaseReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly batchSerial: BatchSerialService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.purchaseReturn.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.purchaseReturn.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('PurchaseReturn', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreatePurchaseReturnDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    await this.assertSupplier(tenantId, organizationId, dto.counterpartyId);
    if (dto.originalGoodsReceiptId) {
      const gr = await this.prisma.goodsReceipt.findFirst({ where: { id: dto.originalGoodsReceiptId, organizationId } });
      if (!gr) throw new ValidationAppError('Original goods receipt does not belong to this organization');
    }
    if (dto.originalPurchaseInvoiceId) {
      const pi = await this.prisma.purchaseInvoice.findFirst({ where: { id: dto.originalPurchaseInvoiceId, organizationId } });
      if (!pi) throw new ValidationAppError('Original purchase invoice does not belong to this organization');
    }

    for (const line of dto.lines) {
      if (!line.sourceReceiptLineId && !line.sourceInvoiceLineId && line.originalUnitPrice === undefined) {
        throw new PurchaseReturnSourceRequiredError();
      }
      if (Number(line.quantity) <= 0) throw new ValidationAppError('Return line quantity must be positive');
    }

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PURCHASE_RETURN_TYPE, businessDate, tx);

      const header = await tx.purchaseReturn.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          number: allocated.formatted,
          documentDate: businessDate,
          originalGoodsReceiptId: dto.originalGoodsReceiptId,
          originalPurchaseInvoiceId: dto.originalPurchaseInvoiceId,
          warehouseId: dto.warehouseId,
          currencyId: dto.currencyId,
          returnReason: dto.returnReason,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of dto.lines.entries()) {
        const created = await tx.purchaseReturnLine.create({
          data: {
            tenantId,
            purchaseReturnId: header.id,
            position: index,
            sourceReceiptLineId: line.sourceReceiptLineId,
            sourceInvoiceLineId: line.sourceInvoiceLineId,
            productId: line.productId,
            unitId: line.unitId,
            quantity: new Decimal(line.quantity.toString()),
            originalUnitPrice: new Decimal(line.originalUnitPrice.toString()),
            batchId: line.batchId,
            reason: line.reason,
          },
        });
        if (line.serialNumbers?.length) {
          await this.batchSerial.captureSerials(tenantId, PURCHASE_RETURN_TYPE, created.id, line.serialNumbers, tx);
        }
      }

      await this.audit.record(
        { tenantId, eventType: 'PURCHASE_RETURN_CREATED', entityType: PURCHASE_RETURN_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, lineCount: dto.lines.length } },
        tx,
      );

      return tx.purchaseReturn.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async assertSupplier(tenantId: string, organizationId: string, counterpartyId: string) {
    const cp = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId, tenantId } });
    if (!cp) throw new ValidationAppError('Counterparty does not belong to this organization');
    if (!SUPPLIER_TYPES.includes(cp.counterpartyType)) throw new ValidationAppError('Counterparty does not have the SUPPLIER role');
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PURCHASE_RETURN_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PURCHASE_RETURN_TYPE, documentType: PURCHASE_RETURN_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
