import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  BatchMismatchError,
  BatchRequiredError,
  SerialCountMismatchError,
  SerialDuplicateError,
  SerialNotAvailableError,
  SerialRequiredError,
  SerialWrongLocationError,
} from '../common/errors/app-error';

export interface ProductTrackingModes {
  batchTrackingMode: string;
  serialTrackingMode: string;
  code: string;
}

/**
 * Batch/serial capture wiring shared by GoodsReceipt/Shipment/SalesReturn/
 * PurchaseReturn (spec sections 19-23) — one implementation instead of
 * four copies. Batches are metadata-only until posting (creating one
 * touches no stock); serial numbers are captured as raw strings at
 * document CREATE time via `DocumentLineSerial` (one row per unit, since
 * a serial-tracked line always posts ONE `InventoryMovement` per unit —
 * spec section 23's "full history per serial", satisfied by a plain
 * ordered query on `InventoryMovement.serialId`, no separate history
 * table) and only resolved into real `SerialNumber` rows at POSTING time
 * — a draft document never touches physical stock or serial status.
 */
@Injectable()
export class BatchSerialService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws if the product's own tracking-mode policy is violated by
   * what was actually captured on the line. */
  validateCapture(product: ProductTrackingModes, batchNumber: string | undefined, serialNumbers: string[] | undefined, quantity: number): void {
    if (product.batchTrackingMode === 'REQUIRED' && !batchNumber) {
      throw new BatchRequiredError(product.code);
    }
    if (product.serialTrackingMode === 'REQUIRED') {
      if (!serialNumbers || serialNumbers.length === 0) throw new SerialRequiredError(product.code);
    }
    if (product.serialTrackingMode !== 'NONE' && serialNumbers && serialNumbers.length > 0) {
      if (serialNumbers.length !== quantity) throw new SerialCountMismatchError(quantity, serialNumbers.length);
    }
  }

  /** Find-or-create a Batch for this product (spec section 19) —
   * metadata only, safe to do at document CREATE time. */
  async resolveOrCreateBatch(
    tenantId: string,
    organizationId: string,
    productId: string,
    productCode: string,
    batchNumber: string,
    extra: { manufactureDate?: Date; expiryDate?: Date; supplierBatchNumber?: string; countryOfOrigin?: string; sourceReceiptId?: string } = {},
    tx: PrismaTransactionClient,
  ): Promise<string> {
    const existing = await tx.batch.findFirst({ where: { tenantId, organizationId, productId, batchNumber } });
    if (existing) {
      if (existing.productId !== productId) throw new BatchMismatchError(batchNumber, productCode);
      return existing.id;
    }
    const created = await tx.batch.create({
      data: {
        tenantId,
        organizationId,
        productId,
        batchNumber,
        manufactureDate: extra.manufactureDate,
        expiryDate: extra.expiryDate,
        supplierBatchNumber: extra.supplierBatchNumber,
        countryOfOrigin: extra.countryOfOrigin,
        sourceReceiptId: extra.sourceReceiptId,
      },
    });
    return created.id;
  }

  /** Stores the raw serial number strings entered on a line — no
   * `SerialNumber` row exists yet. */
  async captureSerials(tenantId: string, documentType: string, lineId: string, serialNumbers: string[], tx: PrismaTransactionClient): Promise<void> {
    for (const [index, serialNumber] of serialNumbers.entries()) {
      await tx.documentLineSerial.create({ data: { tenantId, documentType, lineId, position: index, serialNumber } });
    }
  }

  async getCapturedSerials(tenantId: string, documentType: string, lineId: string, tx: PrismaTransactionClient): Promise<string[]> {
    const rows = await tx.documentLineSerial.findMany({ where: { tenantId, documentType, lineId }, orderBy: { position: 'asc' } });
    return rows.map((r) => r.serialNumber);
  }

  /** POSTING-time resolution for a receipt: creates (or, for a serial
   * seen before, rejects — spec: a serial cannot be received twice while
   * still active) one `SerialNumber` per captured string, links it back
   * onto its `DocumentLineSerial` row, and returns the ids in order. */
  async receiveSerials(
    tenantId: string,
    organizationId: string,
    productId: string,
    warehouseId: string,
    locationId: string | null | undefined,
    documentType: string,
    lineId: string,
    tx: PrismaTransactionClient,
  ): Promise<string[]> {
    const captures = await tx.documentLineSerial.findMany({ where: { tenantId, documentType, lineId }, orderBy: { position: 'asc' } });
    const ids: string[] = [];
    for (const capture of captures) {
      const existing = await tx.serialNumber.findFirst({ where: { organizationId, productId, serialNumber: capture.serialNumber } });
      if (existing && existing.status !== 'CONSUMED' && existing.status !== 'RETIRED') {
        throw new SerialDuplicateError(capture.serialNumber);
      }
      const serial = existing
        ? await tx.serialNumber.update({ where: { id: existing.id }, data: { status: 'AVAILABLE', currentWarehouseId: warehouseId, currentLocationId: locationId ?? undefined, version: { increment: 1 } } })
        : await tx.serialNumber.create({ data: { tenantId, organizationId, productId, serialNumber: capture.serialNumber, status: 'AVAILABLE', currentWarehouseId: warehouseId, currentLocationId: locationId ?? undefined } });
      await tx.documentLineSerial.update({ where: { id: capture.id }, data: { serialId: serial.id } });
      ids.push(serial.id);
    }
    return ids;
  }

  /** POSTING-time resolution for an issue (Shipment/InternalConsumption):
   * every captured serial must already exist, be AVAILABLE, and sit in
   * the issuing warehouse — never trust the draft's own capture. */
  async issueSerials(
    tenantId: string,
    organizationId: string,
    productId: string,
    warehouseId: string,
    warehouseCode: string,
    documentType: string,
    lineId: string,
    tx: PrismaTransactionClient,
  ): Promise<string[]> {
    const captures = await tx.documentLineSerial.findMany({ where: { tenantId, documentType, lineId }, orderBy: { position: 'asc' } });
    const ids: string[] = [];
    for (const capture of captures) {
      const serial = await tx.serialNumber.findFirst({ where: { organizationId, productId, serialNumber: capture.serialNumber } });
      if (!serial || serial.status !== 'AVAILABLE') throw new SerialNotAvailableError(capture.serialNumber, serial?.status ?? 'UNKNOWN');
      if (serial.currentWarehouseId !== warehouseId) {
        const currentWarehouse = serial.currentWarehouseId ? await tx.warehouse.findFirst({ where: { id: serial.currentWarehouseId } }) : null;
        throw new SerialWrongLocationError(capture.serialNumber, currentWarehouse?.code ?? 'UNKNOWN', warehouseCode);
      }
      await tx.serialNumber.update({ where: { id: serial.id }, data: { status: 'CONSUMED', currentWarehouseId: null, currentLocationId: null, version: { increment: 1 } } });
      await tx.documentLineSerial.update({ where: { id: capture.id }, data: { serialId: serial.id } });
      ids.push(serial.id);
    }
    return ids;
  }

  /** POSTING-time resolution for a physical return: the captured serials
   * come back into stock at the return's warehouse. */
  async returnSerials(
    tenantId: string,
    organizationId: string,
    productId: string,
    warehouseId: string,
    locationId: string | null | undefined,
    documentType: string,
    lineId: string,
    tx: PrismaTransactionClient,
  ): Promise<string[]> {
    const captures = await tx.documentLineSerial.findMany({ where: { tenantId, documentType, lineId }, orderBy: { position: 'asc' } });
    const ids: string[] = [];
    for (const capture of captures) {
      const existing = await tx.serialNumber.findFirst({ where: { organizationId, productId, serialNumber: capture.serialNumber } });
      const serial = existing
        ? await tx.serialNumber.update({ where: { id: existing.id }, data: { status: 'AVAILABLE', currentWarehouseId: warehouseId, currentLocationId: locationId ?? undefined, version: { increment: 1 } } })
        : await tx.serialNumber.create({ data: { tenantId, organizationId, productId, serialNumber: capture.serialNumber, status: 'AVAILABLE', currentWarehouseId: warehouseId, currentLocationId: locationId ?? undefined } });
      await tx.documentLineSerial.update({ where: { id: capture.id }, data: { serialId: serial.id } });
      ids.push(serial.id);
    }
    return ids;
  }

  /** Unpost of a receipt: the `SerialNumber` rows this posting created
   * never should have existed physically — delete them (same
   * delete-on-unpost convention `InventoryMovement` itself uses) and
   * detach the capture so a re-post creates them fresh. */
  async undoReceivedSerials(tenantId: string, documentType: string, lineIds: string[], tx: PrismaTransactionClient): Promise<void> {
    if (lineIds.length === 0) return;
    const captures = await tx.documentLineSerial.findMany({ where: { tenantId, documentType, lineId: { in: lineIds }, serialId: { not: null } } });
    for (const capture of captures) {
      await tx.documentLineSerial.update({ where: { id: capture.id }, data: { serialId: null } });
      await tx.serialNumber.deleteMany({ where: { id: capture.serialId!, tenantId } });
    }
  }

  /** Unpost of an issue (Shipment): the serials this posting consumed
   * return to AVAILABLE at the warehouse they were issued from. */
  async undoIssuedSerials(tenantId: string, documentType: string, lineIds: string[], warehouseId: string, tx: PrismaTransactionClient): Promise<void> {
    if (lineIds.length === 0) return;
    const captures = await tx.documentLineSerial.findMany({ where: { tenantId, documentType, lineId: { in: lineIds }, serialId: { not: null } } });
    for (const capture of captures) {
      await tx.serialNumber.updateMany({ where: { id: capture.serialId!, tenantId }, data: { status: 'AVAILABLE', currentWarehouseId: warehouseId, version: { increment: 1 } } });
    }
  }

  /** Unpost of a physical return (SalesReturn/PurchaseReturn): unlike a
   * receipt, the underlying `SerialNumber` row usually already had a
   * movement history BEFORE this return (from the original shipment/
   * receipt it is undoing) — deleting it would violate that history's
   * own FK. Instead, revert it to `CONSUMED` (its state immediately
   * before this return posted) and detach the capture so a re-post
   * resolves it fresh. */
  async undoReturnedSerials(tenantId: string, documentType: string, lineIds: string[], tx: PrismaTransactionClient): Promise<void> {
    if (lineIds.length === 0) return;
    const captures = await tx.documentLineSerial.findMany({ where: { tenantId, documentType, lineId: { in: lineIds }, serialId: { not: null } } });
    for (const capture of captures) {
      await tx.serialNumber.updateMany({ where: { id: capture.serialId!, tenantId }, data: { status: 'CONSUMED', currentWarehouseId: null, currentLocationId: null, version: { increment: 1 } } });
      await tx.documentLineSerial.update({ where: { id: capture.id }, data: { serialId: null } });
    }
  }
}
