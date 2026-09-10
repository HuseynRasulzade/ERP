import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentRepositoryAdapter,
  DocumentStatusPatch,
} from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const SHIPMENT_TYPE = 'SHIPMENT';

@Injectable()
export class ShipmentRepository implements DocumentRepositoryAdapter {
  readonly documentType = SHIPMENT_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.shipment.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ) {
    const result = await tx.shipment.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.postingStatus ? { postingStatus: patch.postingStatus } : {}),
        ...(patch.postedAt !== undefined ? { postedAt: patch.postedAt } : {}),
        ...(patch.postedBy !== undefined ? { postedBy: patch.postedBy } : {}),
        ...(patch.cancelledAt !== undefined ? { cancelledAt: patch.cancelledAt } : {}),
        ...(patch.cancelledBy !== undefined ? { cancelledBy: patch.cancelledBy } : {}),
        version: { increment: 1 },
      },
    });
    return { updatedCount: result.count, newVersion: expectedVersion + 1 };
  }

  async create(
    tenantId: string,
    input: Record<string, unknown>,
    createdBy: string,
    tx: PrismaTransactionClient,
  ): Promise<BaseDocumentFields> {
    const row = await tx.shipment.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        warehouseId: input.warehouseId as string,
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        customerOrderId: input.customerOrderId as string | undefined,
        deliveryAddressSnapshot: input.deliveryAddressSnapshot as string | undefined,
        description: input.description as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });

    const lines = input.lines as Array<Record<string, unknown>> | undefined;
    if (lines?.length) {
      for (const [index, line] of lines.entries()) {
        await tx.shipmentLine.create({
          data: {
            tenantId,
            shipmentId: row.id,
            position: index,
            sourceOrderLineId: line.sourceOrderLineId as string | undefined,
            productId: line.productId as string,
            unitId: line.unitId as string,
            quantity: line.quantity as any,
            warehouseId: (line.warehouseId as string | undefined) ?? (input.warehouseId as string),
            notes: line.notes as string | undefined,
          },
        });
      }
    }

    return this.toBaseFields(row);
  }

  private toBaseFields(row: any): BaseDocumentFields {
    return {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      documentType: row.documentType,
      number: row.number,
      documentDate: row.documentDate,
      postingDate: row.postingDate,
      status: row.status,
      postingStatus: row.postingStatus,
      currencyId: undefined,
      exchangeRate: undefined,
      description: row.description,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      postedAt: row.postedAt,
      postedBy: row.postedBy,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      deletionMark: row.deletionMark,
      version: row.version,
    };
  }
}
