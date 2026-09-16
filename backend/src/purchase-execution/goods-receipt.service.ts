import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RequestContextService } from '../common/context/request-context.service';
import { PermissionCodes } from '../rbac/permission-codes';
import { ApprovalService } from '../approvals/approval.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { GOODS_RECEIPT_TYPE } from './goods-receipt.repository';
import { CreateGoodsReceiptDto, GoodsReceiptLineItemDto } from './dto/purchase-execution.dto';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';
import { PurchaseOrderContractGateService } from '../counterparty-contracts/purchase-order-contract-gate.service';
import { PurchaseFulfillmentService } from './purchase-fulfillment.service';
import { redactGoodsReceiptPrices } from './goods-receipt-redaction.util';

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
  overReceiptReason?: string;
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
    private readonly requestContext: RequestContextService,
    private readonly fulfillment: PurchaseFulfillmentService,
    private readonly approvals: ApprovalService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.goodsReceipt.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    const canViewPrice = this.requestContext.hasPermission(PermissionCodes.PURCHASE_PRICE_VIEW);
    return rows.map((row) => redactGoodsReceiptPrices(row, canViewPrice));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.goodsReceipt.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('GoodsReceipt', id);
    return redactGoodsReceiptPrices(row, this.requestContext.hasPermission(PermissionCodes.PURCHASE_PRICE_VIEW));
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
      if ((order as any).approvalStatus !== 'APPROVED') {
        throw new ValidationAppError('Purchase order is not fully approved yet');
      }
    }

    const lines = await this.resolveLines(tenantId, organizationId, dto.lines);
    await this.ensureSequence(tenantId);
    const canViewPrice = this.requestContext.hasPermission(PermissionCodes.PURCHASE_PRICE_VIEW);

    const created = await this.prisma.runInTransaction(async (tx) => {
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
            overReceiptReason: line.overReceiptReason,
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

      await this.approvals.createStepsForDocument(tenantId, organizationId, GOODS_RECEIPT_TYPE, header.id, tx);

      return tx.goodsReceipt.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
    return redactGoodsReceiptPrices(created, canViewPrice);
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
              overReceiptReason: line.overReceiptReason,
              createdBy: userId,
            },
          });
          if (line.serialNumbers?.length) {
            await this.batchSerial.captureSerials(tenantId, GOODS_RECEIPT_TYPE, created.id, line.serialNumbers, tx);
          }
        }

        // Re-plan approval steps since a line edit can newly introduce or
        // resolve an over-delivery — but never discard a decision already
        // made: skip re-planning if any step has already been acted on.
        const decidedStep = await tx.approvalStep.findFirst({
          where: { tenantId, documentType: GOODS_RECEIPT_TYPE, documentId: id, status: { in: ['APPROVED', 'REJECTED'] } },
        });
        if (!decidedStep) {
          await tx.approvalStep.deleteMany({ where: { tenantId, documentType: GOODS_RECEIPT_TYPE, documentId: id, status: 'PENDING' } });
          await this.approvals.createStepsForDocument(tenantId, organizationId, GOODS_RECEIPT_TYPE, id, tx);
        }
      }

      return tx.goodsReceipt.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });

    await this.audit.record({ tenantId, eventType: 'GOODS_RECEIPT_UPDATED', entityType: GOODS_RECEIPT_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { ...patch, lines: patch.lines?.length } });
    return redactGoodsReceiptPrices(updated, this.requestContext.hasPermission(PermissionCodes.PURCHASE_PRICE_VIEW));
  }

  // -- Approval -----------------------------------------------------------------

  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.approve(tenantId, organizationId, GOODS_RECEIPT_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.reject(tenantId, organizationId, GOODS_RECEIPT_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
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

      const canOverridePrice = this.requestContext.hasPermission(PermissionCodes.PURCHASE_PRICE_VIEW);

      let price: Decimal;
      if (line.supplierOrderLineId) {
        const orderLine = await this.prisma.purchaseOrderLine.findFirst({ where: { id: line.supplierOrderLineId, tenantId } });
        const poPrice = orderLine ? new Decimal(orderLine.price.toString()) : new Decimal(0);
        if (!canOverridePrice) {
          // Backend always computes the price from the approved PO line
          // for anyone without PURCHASE_PRICE_VIEW — a warehouse user's
          // submitted (or omitted) price is silently replaced, never
          // trusted, never rejected with an error.
          price = poPrice;
        } else if (line.price !== undefined) {
          price = new Decimal(line.price.toString());
          if (!price.isFinite() || price.lt(0)) throw new ValidationAppError('Line price must not be negative');
        } else {
          price = poPrice;
        }

        // Over-delivery gate (not just at posting): a line exceeding the
        // PO line's remaining quantity must carry a reason, or the save
        // is rejected outright — never silently allowed, even as a draft.
        const remaining = await this.fulfillment.remainingToReceive(tenantId, line.supplierOrderLineId);
        if (quantity.gt(remaining) && !line.overReceiptReason?.trim()) {
          throw new ValidationAppError(`Line quantity ${quantity.toString()} exceeds the remaining ${remaining.toFixed(6)} for this order line — an overReceiptReason is required to save it`);
        }
      } else if (line.price !== undefined) {
        price = new Decimal(line.price.toString());
        if (!price.isFinite() || price.lt(0)) throw new ValidationAppError('Line price must not be negative');
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
        overReceiptReason: line.overReceiptReason,
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
