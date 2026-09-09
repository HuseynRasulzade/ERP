import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { DocumentLinkService } from './document-link.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * Generic "Create Based On" engine (section 27/28).
 *   getAvailableTargetDocumentTypes(source) -> which mappers exist
 *   createBasedOn(source, targetType) -> new document + DocumentLink,
 *   transactionally, with the mapper resolved by document type (never a
 *   centralized field-mapping table).
 *
 * Cross-tenant target creation is structurally impossible here: the source
 * document is loaded scoped to `tenantId` and the target is always created
 * with that same `tenantId` (scenario G).
 */
@Injectable()
export class CreateBasedOnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: DocumentFrameworkRegistry,
    private readonly documentLinks: DocumentLinkService,
    private readonly audit: AuditService,
  ) {}

  getAvailableTargetDocumentTypes(sourceDocumentType: string): string[] {
    return this.registry.getAvailableTargetDocumentTypes(sourceDocumentType);
  }

  async createBasedOn(
    tenantId: string,
    sourceDocumentType: string,
    sourceDocumentId: string,
    targetDocumentType: string,
    userId: string,
  ) {
    const mapper = this.registry.getMapper(sourceDocumentType, targetDocumentType);
    if (!mapper) {
      throw new ValidationAppError(
        `No Create Based On mapper registered for ${sourceDocumentType} -> ${targetDocumentType}`,
      );
    }

    const sourceRepository = this.registry.getRepository(sourceDocumentType);
    const targetRepository = this.registry.getRepository(targetDocumentType);

    return this.prisma.runInTransaction(async (tx) => {
      const source = await sourceRepository.findById(tenantId, sourceDocumentId, tx);
      if (!source) throw new NotFoundAppError(sourceDocumentType, sourceDocumentId);

      const targetInput = (await mapper.mapHeader(source, tx)) as Record<string, unknown>;
      const target = await targetRepository.create(tenantId, targetInput, userId, tx);

      await this.documentLinks.createLink(
        tenantId,
        {
          sourceDocumentType,
          sourceDocumentId,
          targetDocumentType,
          targetDocumentId: target.id,
          relationType: 'CREATED_BASED_ON',
          createdBy: userId,
        },
        tx,
      );

      await this.audit.record(
        {
          tenantId,
          eventType: 'DOCUMENT_CREATED',
          entityType: targetDocumentType,
          entityId: target.id,
          action: 'CREATE_BASED_ON',
          userId,
          metadata: { sourceDocumentType, sourceDocumentId },
        },
        tx,
      );

      return target;
    });
  }
}
