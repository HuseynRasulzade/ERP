import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

export interface ContractFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required?: boolean;
}

export interface ContractSchema {
  fields: Record<string, ContractFieldSchema>;
}

/**
 * IntegrationContractService (docx spec Phase 28, sections 16-19,
 * 142-144). A contract version's `schema` is a small, closed
 * required-field + primitive-type descriptor — deliberately not full
 * JSON-Schema (no `$ref`/custom keywords/executable `format` validators)
 * so schema validation can never become a scripting surface, matching
 * this codebase's established "safe DSL only" discipline.
 */
@Injectable()
export class IntegrationContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.integrationContract.findMany({ where: { tenantId }, include: { versions: true } });
  }

  async createContract(tenantId: string, input: { code: string; name: string; direction?: 'INBOUND' | 'OUTBOUND' }) {
    return this.prisma.integrationContract.create({ data: { tenantId, code: input.code, name: input.name, direction: input.direction ?? 'INBOUND' } });
  }

  async createVersion(tenantId: string, userId: string, contractId: string, input: { schema: ContractSchema; effectiveFrom: Date; effectiveTo?: Date; backwardCompatible?: boolean }) {
    const contract = await this.prisma.integrationContract.findFirst({ where: { id: contractId, tenantId } });
    if (!contract) throw new NotFoundAppError('IntegrationContract', contractId);
    this.validateSchemaDefinition(input.schema);

    const last = await this.prisma.integrationContractVersion.findFirst({ where: { tenantId, contractId }, orderBy: { version: 'desc' } });
    const row = await this.prisma.integrationContractVersion.create({
      data: {
        tenantId,
        contractId,
        version: (last?.version ?? 0) + 1,
        schema: input.schema as unknown as object,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        backwardCompatible: input.backwardCompatible ?? true,
        status: 'DRAFT',
      },
    });
    await this.audit.record({ tenantId, eventType: 'ContractVersionChanged', eventCategory: 'INTEGRATION', entityType: 'IntegrationContractVersion', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { contractCode: contract.code, version: row.version } });
    return row;
  }

  async activate(tenantId: string, userId: string, versionId: string) {
    const version = await this.getVersion(tenantId, versionId);
    return this.prisma.integrationContractVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE' } });
  }

  /** A superseded-but-still-supported version is DEPRECATED, not
   * retired (spec section 142) — existing integrations keep working
   * against it (spec section 229's own "both v1 and v2 processed using
   * correct schemas") until whoever owns that client migrates. */
  async deprecate(tenantId: string, userId: string, versionId: string) {
    await this.getVersion(tenantId, versionId);
    const updated = await this.prisma.integrationContractVersion.update({ where: { id: versionId }, data: { status: 'DEPRECATED', deprecatedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'ContractVersionChanged', eventCategory: 'INTEGRATION', entityType: 'IntegrationContractVersion', entityId: versionId, operation: 'UPDATE', action: 'DEPRECATE', userId, metadata: {} });
    return updated;
  }

  async resolveVersion(tenantId: string, contractCode: string, version: number) {
    const contract = await this.prisma.integrationContract.findFirst({ where: { tenantId, code: contractCode } });
    if (!contract) throw new NotFoundAppError('IntegrationContract', contractCode);
    const row = await this.prisma.integrationContractVersion.findFirst({ where: { tenantId, contractId: contract.id, version } });
    if (!row) throw new ValidationAppError(`Contract '${contractCode}' has no version ${version}`);
    if (row.status === 'RETIRED') throw new ValidationAppError(`Contract '${contractCode}' version ${version} is retired and no longer accepted`);
    return { contract, version: row };
  }

  /** Validates a raw (already-parsed) payload against a contract
   * version's schema — required fields present, primitive types match.
   * Returns a list of human-readable errors; empty = valid. This is
   * SCHEMA validation only (spec section 32's own layer separation) —
   * mapping/referential/business validation are separate services. */
  validatePayload(schema: ContractSchema, payload: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return ['Payload must be a JSON object'];
    }
    for (const [field, def] of Object.entries(schema.fields)) {
      const value = payload[field];
      if (value === undefined || value === null) {
        if (def.required) errors.push(`Required field '${field}' is missing`);
        continue;
      }
      if (!this.typeMatches(value, def.type)) {
        errors.push(`Field '${field}' expected type ${def.type} but got ${typeof value}`);
      }
    }
    return errors;
  }

  private typeMatches(value: unknown, type: ContractFieldSchema['type']): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));
      case 'boolean':
        return typeof value === 'boolean';
      case 'date':
        return typeof value === 'string' && !Number.isNaN(Date.parse(value));
      case 'object':
        return typeof value === 'object' && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return false;
    }
  }

  private validateSchemaDefinition(schema: ContractSchema) {
    if (!schema || typeof schema !== 'object' || !schema.fields || typeof schema.fields !== 'object') {
      throw new ValidationAppError('Contract schema must be an object with a `fields` map');
    }
  }

  private async getVersion(tenantId: string, versionId: string) {
    const row = await this.prisma.integrationContractVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!row) throw new NotFoundAppError('IntegrationContractVersion', versionId);
    return row;
  }
}
