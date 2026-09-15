import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * IntegrationStagingService (docx spec Phase 28, sections 28-31).
 * A staging record NEVER implies an ERP document exists (spec section
 * 31 — "staging is not business truth") — `targetEntityType`/
 * `targetEntityId` are only populated AFTER `IntegrationImportService`
 * successfully issues a domain command, never before.
 */
@Injectable()
export class IntegrationStagingService {
  constructor(private readonly prisma: PrismaService) {}

  async createBatch(tenantId: string, input: { endpointId: string; contractCode: string; sourceReference?: string; strictAllOrNothing?: boolean; createdBy?: string }, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.integrationStagingBatch.create({
      data: { tenantId, endpointId: input.endpointId, contractCode: input.contractCode, sourceReference: input.sourceReference, strictAllOrNothing: input.strictAllOrNothing ?? false, createdBy: input.createdBy },
    });
  }

  async addRecord(
    tenantId: string,
    batchId: string,
    input: { messageId?: string; sequence: number; rawReference?: string; canonicalData: Record<string, unknown>; mappingVersionId?: string },
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.integrationStagingRecord.create({
      data: {
        tenantId,
        batchId,
        messageId: input.messageId,
        sequence: input.sequence,
        rawReference: input.rawReference,
        canonicalData: input.canonicalData as object,
        mappingVersionId: input.mappingVersionId,
      },
    });
  }

  async updateRecordStatus(
    tenantId: string,
    recordId: string,
    patch: { validationStatus?: string; mappingStatus?: string; matchingStatus?: string; importStatus?: string; errorList?: string[]; targetEntityType?: string; targetEntityId?: string },
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.integrationStagingRecord.update({
      where: { id: recordId },
      data: { ...patch, errorList: patch.errorList ? (patch.errorList as unknown as object) : undefined },
    });
  }

  async finalizeBatchCounts(tenantId: string, batchId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const records = await client.integrationStagingRecord.findMany({ where: { tenantId, batchId } });
    const validCount = records.filter((r) => r.validationStatus === 'SCHEMA_VALID').length;
    const invalidCount = records.filter((r) => r.validationStatus === 'SCHEMA_INVALID').length;
    const duplicateCount = records.filter((r) => r.importStatus === 'DUPLICATE').length;
    const importedCount = records.filter((r) => ['CREATED', 'UPDATED'].includes(r.importStatus)).length;
    return client.integrationStagingBatch.update({
      where: { id: batchId },
      data: { recordCount: records.length, validCount, invalidCount, duplicateCount, importedCount },
    });
  }

  async get(tenantId: string, batchId: string) {
    const batch = await this.prisma.integrationStagingBatch.findFirst({ where: { id: batchId, tenantId }, include: { records: { orderBy: { sequence: 'asc' } } } });
    if (!batch) throw new NotFoundAppError('IntegrationStagingBatch', batchId);
    return batch;
  }
}
