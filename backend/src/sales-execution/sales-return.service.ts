import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ReturnQuantityExceedsSoldError, ValidationAppError } from '../common/errors/app-error';
import { SALES_RETURN_TYPE } from './sales-return.repository';
import { CreateSalesReturnDto } from './dto/sales-execution.dto';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';

const SEQUENCE_PREFIX = 'SRET';

/**
 * SalesReturn (spec sections 47-50). Quantity validated against
 * `sold - already POSTED-returned` per original invoice line (spec
 * section 48: "Do not return more quantity than legally/operationally
 * sold"). `returnType` distinguishes a physical return (affects
 * inventory) from a purely financial correction (spec section 49) —
 * enforced in the posting handler, not here.
 */
@Injectable()
export class SalesReturnService {
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
      .then(() => this.prisma.salesReturn.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.salesReturn.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('SalesReturn', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateSalesReturnDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    let originalInvoice: { id: string; currencyId: string | null } | null = null;
    if (dto.originalSalesInvoiceId) {
      originalInvoice = await this.prisma.salesInvoice.findFirst({ where: { id: dto.originalSalesInvoiceId, tenantId, organizationId } });
      if (!originalInvoice) throw new NotFoundAppError('SalesInvoice', dto.originalSalesInvoiceId);
    }

    const businessDate = parseDate(dto.documentDate);
    let subtotal = new Decimal(0);
    const preparedLines = [];

    for (const line of dto.lines) {
      const quantity = new Decimal(line.quantity);
      if (quantity.lte(0)) throw new ValidationAppError('Return line quantity must be positive');

      let originalUnitPrice = new Decimal(0);
      if (line.sourceInvoiceLineId) {
        const sourceLine = await this.prisma.salesInvoiceLine.findFirst({ where: { id: line.sourceInvoiceLineId, tenantId } });
        if (!sourceLine) throw new NotFoundAppError('SalesInvoiceLine', line.sourceInvoiceLineId);
        originalUnitPrice = new Decimal(sourceLine.price.toString());

        const alreadyReturned = await this.prisma.salesReturnLine.aggregate({
          where: { tenantId, sourceInvoiceLineId: line.sourceInvoiceLineId, salesReturn: { postingStatus: 'POSTED' } },
          _sum: { quantity: true },
        });
        const maxReturnable = new Decimal(sourceLine.quantity.toString()).minus((alreadyReturned._sum.quantity ?? 0).toString());
        if (quantity.gt(maxReturnable)) {
          throw new ReturnQuantityExceedsSoldError(maxReturnable.toFixed(6), quantity.toString());
        }
      }

      subtotal = subtotal.plus(originalUnitPrice.mul(quantity));
      preparedLines.push({ ...line, quantity, originalUnitPrice });
    }

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SALES_RETURN_TYPE, businessDate, tx);

      const header = await tx.salesReturn.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          number: allocated.formatted,
          documentDate: businessDate,
          originalSalesInvoiceId: dto.originalSalesInvoiceId,
          warehouseId: dto.warehouseId,
          currencyId: dto.currencyId ?? originalInvoice?.currencyId,
          returnType: dto.returnType ?? 'PHYSICAL_RETURN',
          reasonCode: dto.reasonCode,
          subtotal: subtotal.toString(),
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of preparedLines.entries()) {
        const created = await tx.salesReturnLine.create({
          data: {
            tenantId,
            salesReturnId: header.id,
            position: index,
            sourceInvoiceLineId: line.sourceInvoiceLineId,
            productId: line.productId,
            unitId: line.unitId,
            quantity: line.quantity.toString(),
            originalUnitPrice: line.originalUnitPrice.toString(),
            batchId: line.batchId,
            reason: line.reason,
          },
        });
        if (line.serialNumbers?.length) {
          await this.batchSerial.captureSerials(tenantId, SALES_RETURN_TYPE, created.id, line.serialNumbers, tx);
        }
      }

      await this.audit.record(
        { tenantId, eventType: 'SALES_RETURN_CREATED', entityType: SALES_RETURN_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number } },
        tx,
      );

      return tx.salesReturn.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SALES_RETURN_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: SALES_RETURN_TYPE, documentType: SALES_RETURN_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}
