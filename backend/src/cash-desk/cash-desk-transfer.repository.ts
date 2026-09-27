import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import {
  DocumentRepositoryAdapter,
  DocumentStatusPatch,
} from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const CASH_DESK_TRANSFER_TYPE = 'CASH_DESK_TRANSFER';

@Injectable()
export class CashDeskTransferRepository implements DocumentRepositoryAdapter {
  readonly documentType = CASH_DESK_TRANSFER_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(
    tenantId: string,
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.cashDeskTransfer.findFirst({
      where: { id, tenantId },
    });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ) {
    // Posting a transfer IS shipping it — INSTANT completes the whole
    // journey in one step (straight to RECEIVED), TWO_STEP only ships
    // (IN_TRANSIT, spec section 8) until the bespoke receive() action
    // moves it on. Unposting reverts to DRAFT so a re-post starts clean.
    const current = patch.postingStatus
      ? await tx.cashDeskTransfer.findFirst({
          where: { id, tenantId },
          select: { transferMode: true, amount: true },
        })
      : null;
    const result = await tx.cashDeskTransfer.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.postingStatus ? { postingStatus: patch.postingStatus } : {}),
        ...(patch.postedAt !== undefined ? { postedAt: patch.postedAt } : {}),
        ...(patch.postedBy !== undefined ? { postedBy: patch.postedBy } : {}),
        ...(patch.cancelledAt !== undefined
          ? { cancelledAt: patch.cancelledAt }
          : {}),
        ...(patch.cancelledBy !== undefined
          ? { cancelledBy: patch.cancelledBy }
          : {}),
        ...(patch.postingStatus === 'POSTED'
          ? {
              transferState:
                current?.transferMode === 'TWO_STEP'
                  ? 'IN_TRANSIT'
                  : 'RECEIVED',
              ...(current?.transferMode !== 'TWO_STEP'
                ? { receivedAmount: current?.amount }
                : {}),
            }
          : {}),
        ...(patch.postingStatus === 'NOT_POSTED'
          ? { transferState: 'DRAFT', receivedAmount: 0 }
          : {}),
        version: { increment: 1 },
      },
    });
    return { updatedCount: result.count, newVersion: expectedVersion + 1 };
  }

  async create(): Promise<BaseDocumentFields> {
    throw new Error(
      'Use CashDeskTransferService.create() — CashDeskTransfer is never created generically',
    );
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
      deletionMark: false,
      version: row.version,
    };
  }
}
