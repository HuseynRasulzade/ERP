import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, TransferAlreadyReceivedError, TransferReceiveExceedsShippedError, ValidationAppError } from '../common/errors/app-error';
import { WAREHOUSE_TRANSFER_TYPE } from './warehouse-transfer.repository';
import { InventoryMovementService } from './inventory-movement.service';
import { CreateWarehouseTransferDto, ReceiveWarehouseTransferDto } from './dto/warehouse-inventory.dto';

const SEQUENCE_PREFIX = 'WTR';

@Injectable()
export class WarehouseTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly movements: InventoryMovementService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.warehouseTransfer.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.warehouseTransfer.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundAppError('WarehouseTransfer', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateWarehouseTransferDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    const transferType = dto.transferType ?? 'INSTANT';

    if (transferType === 'INTERNAL_LOCATION_TRANSFER') {
      if (dto.sourceWarehouseId !== dto.destinationWarehouseId) {
        throw new ValidationAppError('An internal location transfer must use the same warehouse as source and destination');
      }
      for (const line of dto.lines) {
        if (!line.sourceLocationId || !line.destinationLocationId) {
          throw new ValidationAppError('An internal location transfer requires a source and destination location on every line');
        }
      }
    } else if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new ValidationAppError('Source and destination warehouse must differ for a warehouse-to-warehouse transfer');
    }

    const [source, destination] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: dto.sourceWarehouseId, organizationId } }),
      this.prisma.warehouse.findFirst({ where: { id: dto.destinationWarehouseId, organizationId } }),
    ]);
    if (!source) throw new ValidationAppError('Source warehouse does not belong to this organization');
    if (!destination) throw new ValidationAppError('Destination warehouse does not belong to this organization');

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, WAREHOUSE_TRANSFER_TYPE, businessDate, tx);

      const header = await tx.warehouseTransfer.create({
        data: {
          tenantId,
          organizationId,
          sourceWarehouseId: dto.sourceWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          transferType,
          number: allocated.formatted,
          documentDate: businessDate,
          expectedArrivalDate: dto.expectedArrivalDate ? this.parseDate(dto.expectedArrivalDate) : undefined,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of dto.lines.entries()) {
        await tx.warehouseTransferLine.create({
          data: {
            tenantId,
            warehouseTransferId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: new Decimal(line.quantity.toString()),
            batchId: line.batchId,
            sourceLocationId: line.sourceLocationId,
            destinationLocationId: line.destinationLocationId,
            description: line.description,
          },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'WAREHOUSE_TRANSFER_CREATED', entityType: WAREHOUSE_TRANSFER_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, lineCount: dto.lines.length } },
        tx,
      );

      return tx.warehouseTransfer.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    });
  }

  /**
   * Bespoke partial-capable receive command for a TWO_STEP transfer (spec
   * section 12) — moves shipped-but-in-transit quantity at the
   * destination from IN_TRANSIT to AVAILABLE. Deliberately not the
   * generic `unpost`: receiving is a forward-moving business event, not
   * an undo of posting.
   */
  async receive(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, dto: ReceiveWarehouseTransferDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const transfer = await tx.warehouseTransfer.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
      if (!transfer) throw new NotFoundAppError('WarehouseTransfer', id);
      if (transfer.transferType !== 'TWO_STEP') throw new ValidationAppError('Only a TWO_STEP transfer supports a separate receive step');
      if (transfer.postingStatus !== 'POSTED') throw new ValidationAppError('Cannot receive a transfer that has not been shipped (posted) yet');
      if (transfer.transferStatus === 'RECEIVED') throw new TransferAlreadyReceivedError();
      if (transfer.version !== dto.expectedVersion) throw new ConcurrencyConflictError();

      const linesById = new Map(transfer.lines.map((l) => [l.id, l]));

      for (const receiveLine of dto.lines) {
        const line = linesById.get(receiveLine.lineId);
        if (!line) throw new ValidationAppError(`Line ${receiveLine.lineId} does not belong to this transfer`);
        const remaining = new Decimal(line.quantity.toString()).minus(line.receivedQuantity.toString());
        const qty = new Decimal(receiveLine.quantity.toString());
        if (qty.lte(0)) throw new ValidationAppError('Receive quantity must be positive');
        if (qty.gt(remaining)) throw new TransferReceiveExceedsShippedError(remaining.toFixed(6), qty.toFixed(6));

        await this.movements.recordMovement(
          tenantId,
          {
            organizationId,
            warehouseId: transfer.destinationWarehouseId,
            locationId: line.destinationLocationId,
            productId: line.productId,
            unitId: line.unitId,
            batchId: line.batchId,
            stockStatus: 'IN_TRANSIT',
            movementType: 'TRANSFER_RECEIVE_OUT',
            quantity: qty.negated(),
            effectiveDate: new Date(),
            registrarDocumentType: WAREHOUSE_TRANSFER_TYPE,
            registrarDocumentId: transfer.id,
            registrarLineId: line.id,
            createdBy: userId,
          },
          tx,
        );
        await this.movements.recordMovement(
          tenantId,
          {
            organizationId,
            warehouseId: transfer.destinationWarehouseId,
            locationId: line.destinationLocationId,
            productId: line.productId,
            unitId: line.unitId,
            batchId: line.batchId,
            stockStatus: 'AVAILABLE',
            movementType: 'TRANSFER_RECEIVE_IN',
            quantity: qty,
            effectiveDate: new Date(),
            registrarDocumentType: WAREHOUSE_TRANSFER_TYPE,
            registrarDocumentId: transfer.id,
            registrarLineId: line.id,
            createdBy: userId,
          },
          tx,
        );

        await tx.warehouseTransferLine.update({ where: { id: line.id }, data: { receivedQuantity: { increment: qty.toString() } } });
      }

      const refreshedLines = await tx.warehouseTransferLine.findMany({ where: { warehouseTransferId: transfer.id } });
      const fullyReceived = refreshedLines.every((l) => new Decimal(l.receivedQuantity.toString()).gte(new Decimal(l.quantity.toString())));
      const anyReceived = refreshedLines.some((l) => new Decimal(l.receivedQuantity.toString()).gt(0));

      const updated = await tx.warehouseTransfer.update({
        where: { id: transfer.id },
        data: { transferStatus: fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'SHIPPED', version: { increment: 1 } },
        include: { lines: { orderBy: { position: 'asc' } } },
      });

      await this.audit.record(
        { tenantId, eventType: 'WAREHOUSE_TRANSFER_RECEIVED', entityType: WAREHOUSE_TRANSFER_TYPE, entityId: transfer.id, action: 'UPDATE', userId, newValues: { transferStatus: updated.transferStatus } },
        tx,
      );

      return updated;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: WAREHOUSE_TRANSFER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: WAREHOUSE_TRANSFER_TYPE, documentType: WAREHOUSE_TRANSFER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
