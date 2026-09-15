import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { GOODS_RECEIPT_TYPE } from './goods-receipt.repository';
import { CreateGoodsReceiptDto, GoodsReceiptLineItemDto } from './dto/purchase-execution.dto';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';
import { PurchaseOrderContractGateService } from '../counterparty-contracts/purchase-order-contract-gate.service';

const SEQUENCE_PREFIX = 'GR';
const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];

interface ResolvedGRLine {
  productId: string;
  unitId: string;
  quantity: Decimal;
  price: Decimal;
  lineTotal: Decimal;
  warehouseId?: string;
  supplierOrderLineId?: string;
  countryOfOrigin?: string;
  customsDeclaration?: string;
  expiryDate?: Date;
  description?: string;
  batchId?: string;
  serialNumbers?: string[];
}

/**
 * GoodsReceipt service (spec sections 3-5). `price` on a line is
 * informational — it drives the GRNI clearing value and later feeds
 * Purchase Price Variance reporting, but the LEGAL price/tax event is
 * always the Purchase Invoice, never the receipt (spec section 6). When
 * a line carries `supplierOrderLineId` and no explicit price, the price
 * is copied from that PurchaseOrderLine's own frozen snapshot.
 */
@Injectable()
export class GoodsReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly batchSerial: BatchSerialService,
    private readonly contractGate: PurchaseOrderContractGateService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.goodsReceipt.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.goodsReceipt.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('GoodsReceipt', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateGoodsReceiptDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    await this.assertSupplier(tenantId, organizationId, dto.counterpartyId);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, organizationId } });
    if (!warehouse) throw new ValidationAppError('Warehouse does not belong to this organization');
    if (dto.supplierOrderId) {
      const order = await this.prisma.purchaseOrder.findFirst({ where: { id: dto.supplierOrderId, organizationId } });
      if (!order) throw new ValidationAppError('Supplier order does not belong to this organization');
      await this.contractGate.assertApprovedContractExists(tenantId, dto.supplierOrderId);
    }

    const lines = await this.resolveLines(tenantId, organizationId, dto.lines);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, GOODS_RECEIPT_TYPE, businessDate, tx);

      const header = await tx.goodsReceipt.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          warehouseId: dto.warehouseId,
          supplierOrderId: dto.supplierOrderId,
          number: allocated.formatted,
          documentDate: businessDate,
          currencyId: dto.currencyId,
          operationType: dto.operationType ?? 'PURCHASE_FROM_SUPPLIER',
          supplierDocumentNumber: dto.supplierDocumentNumber,
          supplierDocumentDate: dto.supplierDocumentDate ? new Date(dto.supplierDocumentDate) : undefined,
          externalReference: dto.externalReference,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of lines.entries()) {
        const created = await tx.goodsReceiptLine.create({
          data: {
            tenantId,
            goodsReceiptId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: line.quantity,
            price: line.price,
            lineTotal: line.lineTotal,
            warehouseId: line.warehouseId,
            supplierOrderLineId: line.supplierOrderLineId,
            countryOfOrigin: line.countryOfOrigin,
            customsDeclaration: line.customsDeclaration,
            expiryDate: line.expiryDate,
            batchId: line.batchId,
            description: line.description,
            createdBy: userId,
          },
        });
        if (line.serialNumbers?.length) {
          await this.batchSerial.captureSerials(tenantId, GOODS_RECEIPT_TYPE, created.id, line.serialNumbers, tx);
        }
      }

      await this.audit.record(
        { tenantId, eventType: 'GOODS_RECEIPT_CREATED', entityType: GOODS_RECEIPT_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, lineCount: lines.length } },
        tx,
      );

      return tx.goodsReceipt.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: { documentDate?: string; warehouseId?: string; description?: string; lines?: GoodsReceiptLineItemDto[] }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus === 'POSTED') throw new ValidationAppError('Unpost the goods receipt before editing it');
    if (current.status === 'CANCELLED') throw new ValidationAppError('Cannot edit a cancelled goods receipt');

    let resolved: ResolvedGRLine[] | null = null;
    if (patch.lines !== undefined) {
      if (patch.lines.length === 0) throw new ValidationAppError('Goods receipt must have at least one line');
      resolved = await this.resolveLines(tenantId, organizationId, patch.lines);
    }

    const updated = await this.prisma.runInTransaction(async (tx) => {
      const result = await tx.goodsReceipt.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: {
          ...(patch.documentDate !== undefined ? { documentDate: this.parseDate(patch.documentDate) } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      if (resolved) {
        await tx.goodsReceiptLine.deleteMany({ where: { goodsReceiptId: id } });
        for (const [index, line] of resolved.entries()) {
          const created = await tx.goodsReceiptLine.create({
            data: {
              tenantId,
              goodsReceiptId: id,
              position: index,
              productId: line.productId,
              unitId: line.unitId,
              quantity: line.quantity,
              price: line.price,
              lineTotal: line.lineTotal,
              warehouseId: line.warehouseId,
              supplierOrderLineId: line.supplierOrderLineId,
              countryOfOrigin: line.countryOfOrigin,
              customsDeclaration: line.customsDeclaration,
              expiryDate: line.expiryDate,
              batchId: line.batchId,
              description: line.description,
              createdBy: userId,
            },
          });
          if (line.serialNumbers?.length) {
            await this.batchSerial.captureSerials(tenantId, GOODS_RECEIPT_TYPE, created.id, line.serialNumbers, tx);
          }
        }
      }

      return tx.goodsReceipt.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });

    await this.audit.record({ tenantId, eventType: 'GOODS_RECEIPT_UPDATED', entityType: GOODS_RECEIPT_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { ...patch, lines: patch.lines?.length } });
    return updated;
  }

  // -- helpers ----------------------------------------------------------------

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async assertSupplier(tenantId: string, organizationId: string, counterpartyId: string) {
    const cp = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId, tenantId } });
    if (!cp) throw new ValidationAppError('Counterparty does not belong to this organization');
    if (!cp.active) throw new ValidationAppError('Counterparty is inactive');
    if (!SUPPLIER_TYPES.includes(cp.counterpartyType)) throw new ValidationAppError('Counterparty does not have the SUPPLIER role');
  }

  private async resolveLines(tenantId: string, organizationId: string, lines: GoodsReceiptLineItemDto[]): Promise<ResolvedGRLine[]> {
    const resolved: ResolvedGRLine[] = [];
    for (const line of lines) {
      const quantity = new Decimal(line.quantity.toString());
      if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationAppError('Line quantity must be positive');

      const product = await this.prisma.product.findFirst({ where: { id: line.productId, organizationId } });
      if (!product || !product.active) throw new ValidationAppError('Product does not belong to this organization or is inactive');
      const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id: line.unitId, tenantId } });
      if (!unit) throw new ValidationAppError('Unit of measure not found');

      this.batchSerial.validateCapture(product, line.batchNumber, line.serialNumbers, quantity.toNumber());
      let batchId: string | undefined;
      if (line.batchNumber) {
        batchId = await this.batchSerial.resolveOrCreateBatch(
          tenantId,
          organizationId,
          line.productId,
          product.code,
          line.batchNumber,
          { expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined, supplierBatchNumber: line.supplierBatchNumber },
          this.prisma,
        );
      }

      let price: Decimal;
      if (line.price !== undefined) {
        price = new Decimal(line.price.toString());
        if (!price.isFinite() || price.lt(0)) throw new ValidationAppError('Line price must not be negative');
      } else if (line.supplierOrderLineId) {
        const orderLine = await this.prisma.purchaseOrderLine.findFirst({ where: { id: line.supplierOrderLineId, tenantId } });
        price = orderLine ? new Decimal(orderLine.price.toString()) : new Decimal(0);
      } else {
        price = new Decimal(0);
      }

      resolved.push({
        productId: line.productId,
        unitId: line.unitId,
        quantity,
        price,
        lineTotal: quantity.mul(price).toDecimalPlaces(2),
        warehouseId: line.warehouseId,
        supplierOrderLineId: line.supplierOrderLineId,
        countryOfOrigin: line.countryOfOrigin,
        customsDeclaration: line.customsDeclaration,
        expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
        description: line.description,
        batchId,
        serialNumbers: line.serialNumbers,
      });
    }
    return resolved;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: GOODS_RECEIPT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: GOODS_RECEIPT_TYPE, documentType: GOODS_RECEIPT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
