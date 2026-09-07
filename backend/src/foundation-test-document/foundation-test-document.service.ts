import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { FOUNDATION_TEST_DOCUMENT_TYPE } from './foundation-test-document.repository';

const SEQUENCE_CODE = FOUNDATION_TEST_DOCUMENT_TYPE;

/**
 * Demonstrates the "SAVE is not POST" distinction (section 10): creating
 * and editing a FoundationTestDocument here never touches posting_status —
 * only DocumentPostingService (via the generic /documents/.../post command)
 * does that.
 */
@Injectable()
export class FoundationTestDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    input: { organizationId?: string; documentDate: Date; currencyId?: string; amount: string; description?: string },
  ) {
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SEQUENCE_CODE, input.documentDate, tx);

      const document = await tx.foundationTestDocument.create({
        data: {
          tenantId,
          organizationId: input.organizationId,
          number: allocated.formatted,
          documentDate: input.documentDate,
          currencyId: input.currencyId,
          amount: input.amount,
          description: input.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'DOCUMENT_CREATED',
          entityType: FOUNDATION_TEST_DOCUMENT_TYPE,
          entityId: document.id,
          action: 'CREATE',
          userId,
          newValues: { number: document.number, amount: document.amount.toString() },
        },
        tx,
      );

      return document;
    });
  }

  async get(tenantId: string, id: string) {
    const document = await this.prisma.foundationTestDocument.findFirst({ where: { id, tenantId } });
    if (!document) throw new NotFoundAppError(FOUNDATION_TEST_DOCUMENT_TYPE, id);
    return document;
  }

  list(tenantId: string) {
    return this.prisma.foundationTestDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    tenantId: string,
    id: string,
    userId: string,
    patch: { amount: string; description?: string; expectedVersion: number },
  ) {
    const current = await this.get(tenantId, id);
    if (current.postingStatus === 'POSTED') {
      throw new ValidationAppError('Unpost the document before editing it');
    }

    const result = await this.prisma.foundationTestDocument.updateMany({
      where: { id, tenantId, version: patch.expectedVersion },
      data: { amount: patch.amount, description: patch.description, updatedBy: userId, version: { increment: 1 } },
    });

    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'DOCUMENT_UPDATED',
      entityType: FOUNDATION_TEST_DOCUMENT_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      oldValues: { amount: current.amount.toString(), description: current.description },
      newValues: { amount: patch.amount, description: patch.description },
    });

    return this.get(tenantId, id);
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: SEQUENCE_CODE } },
    });
    if (existing) return;

    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: SEQUENCE_CODE,
          documentType: FOUNDATION_TEST_DOCUMENT_TYPE,
          prefix: 'FTD',
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race to create the sequence for this tenant — another
      // concurrent create() already did it, which is fine.
    }
  }
}
