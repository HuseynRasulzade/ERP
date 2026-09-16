import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { ApprovalService } from '../approvals/approval.service';
import { ConcurrencyConflictError, DuplicateSupplierInvoiceError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PURCHASE_INVOICE_TYPE } from './purchase-invoice.repository';
import { CreatePurchaseInvoiceDto, PurchaseInvoiceLineItemDto, UpdatePurchaseInvoiceDto } from './dto/purchase-execution.dto';
import { PurchaseOrderContractGateService } from '../counterparty-contracts/purchase-order-contract-gate.service';

const SEQUENCE_PREFIX = 'PI';
const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];
const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

interface ResolvedPILine {
  lineType: string;
  productId?: string;
  unitId?: string;
  quantity: Decimal;
  price: Decimal;
  discountAmount: Decimal;
  lineTotal: Decimal;
  taxRate: Decimal;
  taxAmount: Decimal;
  lineTotalWithTax: Decimal;
  warehouseId?: string;
  expenseAccountId?: string;
  departmentId?: string;
  goodsReceiptLineId?: string;
  supplierOrderLineId?: string;
  description?: string;
}

/**
 * PurchaseInvoice service (spec sections 6-9, 36). Line totals stored
 * here are a PREVIEW — `PurchaseInvoicePostingHandler` recomputes the
 * real tax via the Tax Engine fresh at posting time (never trusts this
 * snapshot for the GL/Tax Register consequence), exactly mirroring
 * SalesInvoiceService/SalesInvoicePostingHandler's split.
 *
 * Duplicate supplier invoice control (spec section 36): checked here at
 * create/update time (default rule `supplierId + supplierInvoiceNumber +
 * organizationId`) AND enforced at the database level by a unique
 * constraint — the explicit check gives a clear error message, the
 * constraint is the actual race-safe guarantee.
 */
@Injectable()
export class PurchaseInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly contractGate: PurchaseOrderContractGateService,
    private readonly approvals: ApprovalService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.purchaseInvoice.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.purchaseInvoice.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('PurchaseInvoice', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreatePurchaseInvoiceDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    await this.assertSupplier(tenantId, organizationId, dto.counterpartyId);
    if (dto.supplierInvoiceNumber) await this.assertNoDuplicate(organizationId, dto.counterpartyId, dto.supplierInvoiceNumber);
    if (dto.supplierOrderId) await this.contractGate.assertApprovedContractExists(tenantId, dto.supplierOrderId);

    const priceIncludesTax = dto.priceIncludesTax ?? false;
    const lines = await this.resolveLines(tenantId, organizationId, dto.lines, businessDate, priceIncludesTax);
    const totals = sumTotals(lines);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PURCHASE_INVOICE_TYPE, businessDate, tx);

      const header = await tx.purchaseInvoice.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          number: allocated.formatted,
          documentDate: businessDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          currencyId: dto.currencyId,
          supplierInvoiceNumber: dto.supplierInvoiceNumber,
          supplierInvoiceDate: dto.supplierInvoiceDate ? new Date(dto.supplierInvoiceDate) : undefined,
          supplierOrderId: dto.supplierOrderId,
          goodsReceiptId: dto.goodsReceiptId,
          priceIncludesTax,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.createLines(tx, tenantId, header.id, lines);

      await this.audit.record(
        { tenantId, eventType: 'PURCHASE_INVOICE_CREATED', entityType: PURCHASE_INVOICE_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, grandTotal: totals.grandTotal.toString() } },
        tx,
      );

      await this.approvals.createStepsForDocument(tenantId, organizationId, PURCHASE_INVOICE_TYPE, header.id, tx);

      return tx.purchaseInvoice.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: { documentDate?: string; dueDate?: string; description?: string; lines?: PurchaseInvoiceLineItemDto[] }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus === 'POSTED') throw new ValidationAppError('Unpost the purchase invoice before editing it');
    if (current.status === 'CANCELLED') throw new ValidationAppError('Cannot edit a cancelled purchase invoice');

    const businessDate = patch.documentDate !== undefined ? this.parseDate(patch.documentDate) : current.documentDate;
    let totals = { subtotal: current.subtotal, taxTotal: current.taxTotal, grandTotal: current.grandTotal };
    let resolved: ResolvedPILine[] | null = null;
    if (patch.lines !== undefined) {
      if (patch.lines.length === 0) throw new ValidationAppError('Purchase invoice must have at least one line');
      resolved = await this.resolveLines(tenantId, organizationId, patch.lines, businessDate, current.priceIncludesTax);
      totals = sumTotals(resolved);
    }

    const updated = await this.prisma.runInTransaction(async (tx) => {
      const result = await tx.purchaseInvoice.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: {
          ...(patch.documentDate !== undefined ? { documentDate: businessDate } : {}),
          ...(patch.dueDate !== undefined ? { dueDate: new Date(patch.dueDate) } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      if (resolved) {
        await tx.purchaseInvoiceLine.deleteMany({ where: { purchaseInvoiceId: id } });
        await this.createLines(tx, tenantId, id, resolved);

        // Re-plan approval steps since a price edit can newly introduce or
        // resolve a variance — but never discard a decision already made.
        const decidedStep = await tx.approvalStep.findFirst({
          where: { tenantId, documentType: PURCHASE_INVOICE_TYPE, documentId: id, status: { in: ['APPROVED', 'REJECTED'] } },
        });
        if (!decidedStep) {
          await tx.approvalStep.deleteMany({ where: { tenantId, documentType: PURCHASE_INVOICE_TYPE, documentId: id, status: 'PENDING' } });
          await this.approvals.createStepsForDocument(tenantId, organizationId, PURCHASE_INVOICE_TYPE, id, tx);
        }
      }

      return tx.purchaseInvoice.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });

    await this.audit.record({ tenantId, eventType: 'PURCHASE_INVOICE_UPDATED', entityType: PURCHASE_INVOICE_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { ...patch, lines: patch.lines?.length } });
    return updated;
  }

  // -- Approval -----------------------------------------------------------------

  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.approve(tenantId, organizationId, PURCHASE_INVOICE_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.reject(tenantId, organizationId, PURCHASE_INVOICE_TYPE, id, userId, comment);
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

  private async assertNoDuplicate(organizationId: string, counterpartyId: string, supplierInvoiceNumber: string, excludeId?: string) {
    const existing = await this.prisma.purchaseInvoice.findFirst({ where: { organizationId, counterpartyId, supplierInvoiceNumber, id: excludeId ? { not: excludeId } : undefined } });
    if (existing) throw new DuplicateSupplierInvoiceError(supplierInvoiceNumber);
  }

  private async resolveLines(tenantId: string, organizationId: string, lines: PurchaseInvoiceLineItemDto[], businessDate: Date, priceIncludesTax: boolean): Promise<ResolvedPILine[]> {
    const resolved: ResolvedPILine[] = [];
    for (const line of lines) {
      const lineType = line.lineType ?? 'INVENTORY';
      const quantity = new Decimal(line.quantity.toString());
      if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationAppError('Line quantity must be positive');
      const price = new Decimal(line.price.toString());
      if (!price.isFinite() || price.lt(0)) throw new ValidationAppError('Line price must not be negative');
      const discountAmount = new Decimal((line.discountAmount ?? 0).toString());

      if (lineType === 'INVENTORY' || lineType === 'SERVICE') {
        if (!line.productId) throw new ValidationAppError('INVENTORY/SERVICE lines require a product');
        const product = await this.prisma.product.findFirst({ where: { id: line.productId, organizationId } });
        if (!product || !product.active) throw new ValidationAppError('Product does not belong to this organization or is inactive');
      }
      if (line.unitId) {
        const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id: line.unitId, tenantId } });
        if (!unit) throw new ValidationAppError('Unit of measure not found');
      }

      const gross = quantity.mul(price).minus(discountAmount);
      const net = gross.toDecimalPlaces(2);

      let taxRate: Decimal;
      if (line.taxRate !== undefined) {
        taxRate = new Decimal(line.taxRate.toString());
      } else {
        const preview = await this.taxCalculation.calculateLine(
          { tenantId, organizationId, businessDate, taxPointDate: businessDate, operationType: 'PURCHASE', taxCategoryCode: DEFAULT_TAX_CATEGORY, taxpayerSide: 'BUYER' },
          { amount: net, priceIncludesTax: false },
        );
        taxRate = preview.rate;
      }
      const taxAmount = net.mul(taxRate).div(100).toDecimalPlaces(2);

      resolved.push({
        lineType,
        productId: line.productId,
        unitId: line.unitId,
        quantity,
        price,
        discountAmount,
        lineTotal: net,
        taxRate,
        taxAmount,
        lineTotalWithTax: net.plus(taxAmount),
        warehouseId: line.warehouseId,
        expenseAccountId: line.expenseAccountId,
        departmentId: line.departmentId,
        goodsReceiptLineId: line.goodsReceiptLineId,
        supplierOrderLineId: line.supplierOrderLineId,
        description: line.description,
      });
    }
    return resolved;
  }

  private async createLines(tx: any, tenantId: string, purchaseInvoiceId: string, lines: ResolvedPILine[]) {
    for (const [index, line] of lines.entries()) {
      await tx.purchaseInvoiceLine.create({
        data: {
          tenantId,
          purchaseInvoiceId,
          position: index,
          lineType: line.lineType,
          productId: line.productId,
          unitId: line.unitId,
          quantity: line.quantity,
          price: line.price,
          discountAmount: line.discountAmount,
          lineTotal: line.lineTotal,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          lineTotalWithTax: line.lineTotalWithTax,
          warehouseId: line.warehouseId,
          expenseAccountId: line.expenseAccountId,
          departmentId: line.departmentId,
          goodsReceiptLineId: line.goodsReceiptLineId,
          supplierOrderLineId: line.supplierOrderLineId,
          description: line.description,
        },
      });
    }
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PURCHASE_INVOICE_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PURCHASE_INVOICE_TYPE, documentType: PURCHASE_INVOICE_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}

function sumTotals(lines: ResolvedPILine[]): { subtotal: Decimal; taxTotal: Decimal; grandTotal: Decimal } {
  let subtotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  let grandTotal = new Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.plus(line.lineTotal);
    taxTotal = taxTotal.plus(line.taxAmount);
    grandTotal = grandTotal.plus(line.lineTotalWithTax);
  }
  return { subtotal, taxTotal, grandTotal };
}
