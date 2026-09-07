import { Injectable } from '@nestjs/common';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { FOUNDATION_TEST_DOCUMENT_TYPE } from './foundation-test-document.repository';

/**
 * Demo mapper proving the Create Based On engine end to end (scenario G):
 * creates a follow-up FoundationTestDocument inheriting header values from
 * the source. A real mapper (e.g. CustomerOrderToShipmentMapper, Phase 27+)
 * looks the same shape but maps business-specific fields.
 */
@Injectable()
export class FoundationTestDocumentSelfMapper
  implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>>
{
  readonly sourceDocumentType = FOUNDATION_TEST_DOCUMENT_TYPE;
  readonly targetDocumentType = FOUNDATION_TEST_DOCUMENT_TYPE;

  mapHeader(source: BaseDocumentFields): Record<string, unknown> {
    return {
      organizationId: source.organizationId,
      documentDate: new Date(),
      currencyId: source.currencyId,
      amount: 0, // inherited quantity/amount fields are Phase 27 concern; header only here
      description: `Follow-up of ${source.number ?? source.id}`,
    };
  }
}
