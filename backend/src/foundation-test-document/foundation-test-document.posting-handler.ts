import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { FOUNDATION_TEST_DOCUMENT_TYPE } from './foundation-test-document.repository';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * Minimal demo posting handler (section 58): proves validateForPosting /
 * buildMovements are called through the generic registry and that the
 * resulting RegisterMovement rows carry correct recorder ownership
 * (section 64). Never used for anything beyond exercising the framework.
 */
@Injectable()
export class FoundationTestDocumentPostingHandler implements DocumentPostingHandler {
  readonly documentType = FOUNDATION_TEST_DOCUMENT_TYPE;

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const row = await tx.foundationTestDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!row) throw new ValidationAppError('Document disappeared during posting');
    if (row.amount.isZero()) {
      throw new ValidationAppError('Cannot post a foundation test document with zero amount');
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const row = await tx.foundationTestDocument.findFirst({ where: { id: document.id, tenantId } });
    if (!row) throw new ValidationAppError('Document disappeared during posting');

    return [
      {
        registerCode: 'FOUNDATION_TEST_REGISTER',
        businessDate: document.postingDate ?? document.documentDate,
        movementType: 'DEMO_MOVEMENT',
        resources: { amount: row.amount.toString(), currencyId: row.currencyId },
        dimensions: { organizationId: document.organizationId ?? null },
      },
    ];
  }
}
