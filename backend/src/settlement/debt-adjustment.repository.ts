import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentRepositoryAdapter, DocumentStatusPatch } from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const DEBT_ADJUSTMENT_TYPE = 'DEBT_ADJUSTMENT';

@Injectable()
export class DebtAdjustmentRepository implements DocumentRepositoryAdapter {
  readonly documentType = DEBT_ADJUSTMENT_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.debtAdjustment.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(tenantId: string, id: string, patch: DocumentStatusPatch, expectedVersion: number, tx: PrismaTransactionClient) {
    const result = await tx.debtAdjustment.updateMany({
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

  async create(tenantId: string, input: Record<string, unknown>, createdBy: string, tx: PrismaTransactionClient): Promise<BaseDocumentFields> {
    const row = await tx.debtAdjustment.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        counterpartyRole: input.counterpartyRole as string,
        contractId: input.contractId as string | undefined,
        operationType: input.operationType as string,
        reasonCode: input.reasonCode as string | undefined,
        targetOpenItemType: input.targetOpenItemType as string | undefined,
        targetOpenItemId: input.targetOpenItemId as string | undefined,
        targetContractId: input.targetContractId as string | undefined,
        targetCounterpartyId: input.targetCounterpartyId as string | undefined,
        currencyId: input.currencyId as string,
        amount: (input.amount as number).toString(),
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        description: input.description as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });
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
      currencyId: row.currencyId,
      exchangeRate: null,
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
