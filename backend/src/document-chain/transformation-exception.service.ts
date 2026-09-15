import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface RecordExceptionInput {
  transformationCode?: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  exceptionType: 'NO_APPLICABLE_VERSION' | 'SOURCE_NOT_ELIGIBLE' | 'CURRENCY_MISMATCH' | 'MERGE_INCOMPATIBILITY' | 'CLAIM_CONFLICT' | 'SOURCE_STALE' | 'TARGET_VALIDATION_FAILED' | 'CYCLE_DETECTED' | 'DOWNSTREAM_BLOCKER' | 'MAPPING_ERROR';
  severity?: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  message: string;
}

/** TransformationExceptionService (docx spec Phase 27, section 20's own
 * requirement that failures are recorded, not just thrown-and-forgotten,
 * so an admin screen can see recurring transformation problems). */
@Injectable()
export class TransformationExceptionService {
  constructor(private readonly prisma: PrismaService) {}

  record(tenantId: string, input: RecordExceptionInput) {
    return this.prisma.transformationException.create({
      data: {
        tenantId,
        transformationCode: input.transformationCode,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        exceptionType: input.exceptionType,
        severity: input.severity ?? 'ERROR',
        message: input.message,
      },
    });
  }

  list(tenantId: string, filters: { resolved?: boolean; sourceDocumentType?: string; sourceDocumentId?: string } = {}) {
    return this.prisma.transformationException.findMany({
      where: { tenantId, resolved: filters.resolved, sourceDocumentType: filters.sourceDocumentType, sourceDocumentId: filters.sourceDocumentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolve(tenantId: string, id: string) {
    const row = await this.prisma.transformationException.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('TransformationException', id);
    return this.prisma.transformationException.update({ where: { id }, data: { resolved: true, resolvedAt: new Date() } });
  }
}
