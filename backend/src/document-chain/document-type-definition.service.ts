import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface CreateDocumentTypeDefinitionInput {
  code: string;
  module: string;
  entityType: string;
  lineEntityType?: string;
  supportsCreateBasedOn?: boolean;
  supportsLineProvenance?: boolean;
}

/**
 * DocumentTypeDefinitionService (docx spec Phase 27, section 4). A thin,
 * purely descriptive registry of which document types exist and whether
 * they participate in the governed Create Based On engine — NOT a second
 * document-repository/handler registry (that already exists and is
 * reused as-is: `DocumentFrameworkRegistry`, `src/document-framework/`).
 * This table only carries metadata a UI/admin screen needs (which
 * modules exist, whether line provenance is meaningful for them) and
 * that `DocumentTransformationDefinitionService` validates against.
 */
@Injectable()
export class DocumentTypeDefinitionService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.documentTypeDefinition.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async get(tenantId: string, code: string) {
    const row = await this.prisma.documentTypeDefinition.findFirst({ where: { tenantId, code } });
    if (!row) throw new NotFoundAppError('DocumentTypeDefinition', code);
    return row;
  }

  async create(tenantId: string, input: CreateDocumentTypeDefinitionInput) {
    if (!input.code || !input.module || !input.entityType) {
      throw new ValidationAppError('code, module and entityType are required');
    }
    return this.prisma.documentTypeDefinition.create({
      data: {
        tenantId,
        code: input.code,
        module: input.module,
        entityType: input.entityType,
        lineEntityType: input.lineEntityType,
        supportsCreateBasedOn: input.supportsCreateBasedOn ?? true,
        supportsLineProvenance: input.supportsLineProvenance ?? true,
      },
    });
  }

  async setActive(tenantId: string, code: string, active: boolean) {
    const row = await this.get(tenantId, code);
    return this.prisma.documentTypeDefinition.update({ where: { id: row.id }, data: { active } });
  }
}
