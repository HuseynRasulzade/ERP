import { Injectable } from '@nestjs/common';
import { DocumentPostingHandler } from './document-posting-handler.interface';
import { DocumentRepositoryAdapter } from './document-repository.interface';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';

/**
 * Handler registry / strategy pattern (section 12): each future document
 * type registers itself on module init instead of the posting engine
 * containing a giant `if (document.type === ...)` switch.
 */
@Injectable()
export class DocumentFrameworkRegistry {
  private readonly handlers = new Map<string, DocumentPostingHandler>();
  private readonly repositories = new Map<string, DocumentRepositoryAdapter>();

  registerHandler(handler: DocumentPostingHandler) {
    if (this.handlers.has(handler.documentType)) {
      throw new Error(`Posting handler already registered for ${handler.documentType}`);
    }
    this.handlers.set(handler.documentType, handler);
  }

  getHandler(documentType: string): DocumentPostingHandler {
    const handler = this.handlers.get(documentType);
    if (!handler) {
      throw new Error(`No posting handler registered for document type: ${documentType}`);
    }
    return handler;
  }

  registerRepository(repository: DocumentRepositoryAdapter) {
    if (this.repositories.has(repository.documentType)) {
      throw new Error(`Repository adapter already registered for ${repository.documentType}`);
    }
    this.repositories.set(repository.documentType, repository);
  }

  getRepository(documentType: string): DocumentRepositoryAdapter {
    const repository = this.repositories.get(documentType);
    if (!repository) {
      throw new Error(`No repository adapter registered for document type: ${documentType}`);
    }
    return repository;
  }

  // -- Create Based On mapper registry (section 27) -------------------------
  private readonly mappers = new Map<string, CreateBasedOnMapper>();

  registerMapper(mapper: CreateBasedOnMapper) {
    this.mappers.set(this.mapperKey(mapper.sourceDocumentType, mapper.targetDocumentType), mapper);
  }

  getMapper(sourceDocumentType: string, targetDocumentType: string): CreateBasedOnMapper | undefined {
    return this.mappers.get(this.mapperKey(sourceDocumentType, targetDocumentType));
  }

  getAvailableTargetDocumentTypes(sourceDocumentType: string): string[] {
    return Array.from(this.mappers.values())
      .filter((m) => m.sourceDocumentType === sourceDocumentType)
      .map((m) => m.targetDocumentType);
  }

  private mapperKey(source: string, target: string) {
    return `${source}=>${target}`;
  }
}
