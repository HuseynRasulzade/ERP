import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { WorkflowConditionService, ConditionNode } from '../workflow/workflow-condition.service';
import { TransformationMappingService, HeaderMappingRule } from '../document-chain/transformation-mapping.service';

export type IntegrationMappingType = 'DIRECT' | 'CONSTANT' | 'LOOKUP' | 'FORMAT_CONVERSION' | 'VALUE_MAP' | 'CONDITIONAL' | 'DERIVED_SAFE_EXPRESSION' | 'IGNORE' | 'REQUIRED_MANUAL';

export interface IntegrationFieldMapping {
  targetField: string;
  mappingType: IntegrationMappingType;
  sourceField?: string; // DIRECT/FORMAT_CONVERSION/VALUE_MAP
  constant?: unknown; // CONSTANT
  lookupTable?: Record<string, unknown>; // LOOKUP/VALUE_MAP (versioned value maps, spec section 37)
  format?: 'ISO_DATE' | 'UPPERCASE' | 'LOWERCASE' | 'TRIM' | 'FIXED_2_DECIMALS'; // FORMAT_CONVERSION
  condition?: ConditionNode; // CONDITIONAL
  whenTrueConstant?: unknown; // CONDITIONAL
  whenFalseConstant?: unknown; // CONDITIONAL
  derivedFrom?: string[]; // DERIVED_SAFE_EXPRESSION — coalesce, same closed primitive as Phase 27
}

/**
 * IntegrationMappingService (docx spec Phase 28, sections 33-40).
 * Reuses `TransformationMappingService` (Phase 27's own safe mapping
 * primitives — DIRECT/CONSTANT/LOOKUP/IGNORE/REQUIRED_MANUAL map 1:1
 * onto that service's COPY/CONSTANT/LOOKUP/DO_NOT_COPY/USER_REQUIRED)
 * rather than re-implementing a second mapping engine; only the types
 * that have no Phase 27 equivalent (`FORMAT_CONVERSION`, `VALUE_MAP`,
 * `CONDITIONAL`, `DERIVED_SAFE_EXPRESSION`) are implemented here, and
 * `DERIVED_SAFE_EXPRESSION` is itself the same closed coalesce-only
 * primitive as Phase 27's `DERIVED_RULE` — never an arbitrary formula
 * (spec section 36's own "no arbitrary executable scripts").
 */
@Injectable()
export class IntegrationMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly condition: WorkflowConditionService,
    private readonly transformationMapping: TransformationMappingService,
  ) {}

  list(tenantId: string) {
    return this.prisma.integrationMappingProfile.findMany({ where: { tenantId }, include: { versions: true } });
  }

  async createProfile(tenantId: string, input: { code: string; name: string; connectorId?: string }) {
    return this.prisma.integrationMappingProfile.create({ data: { tenantId, ...input } });
  }

  async createVersion(tenantId: string, userId: string, mappingProfileId: string, input: { sourceContractVersionId: string; targetCanonicalContract: string; fieldMappings: IntegrationFieldMapping[]; effectiveFrom: Date; effectiveTo?: Date }) {
    const profile = await this.prisma.integrationMappingProfile.findFirst({ where: { id: mappingProfileId, tenantId } });
    if (!profile) throw new NotFoundAppError('IntegrationMappingProfile', mappingProfileId);
    this.validateFieldMappings(input.fieldMappings);

    const last = await this.prisma.integrationMappingVersion.findFirst({ where: { tenantId, mappingProfileId }, orderBy: { version: 'desc' } });
    return this.prisma.integrationMappingVersion.create({
      data: {
        tenantId,
        mappingProfileId,
        version: (last?.version ?? 0) + 1,
        sourceContractVersionId: input.sourceContractVersionId,
        targetCanonicalContract: input.targetCanonicalContract,
        fieldMappings: input.fieldMappings as unknown as object,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        status: 'DRAFT',
        createdBy: userId,
      },
    });
  }

  validateFieldMappings(mappings: IntegrationFieldMapping[]) {
    if (!Array.isArray(mappings) || mappings.length === 0) throw new ValidationAppError('fieldMappings must be a non-empty array');
    for (const m of mappings) {
      if (!m.targetField) throw new ValidationAppError('Every field mapping needs a targetField');
      switch (m.mappingType) {
        case 'DIRECT':
          if (!m.sourceField) throw new ValidationAppError(`DIRECT mapping for ${m.targetField} needs sourceField`);
          break;
        case 'CONSTANT':
          if (m.constant === undefined) throw new ValidationAppError(`CONSTANT mapping for ${m.targetField} needs constant`);
          break;
        case 'LOOKUP':
        case 'VALUE_MAP':
          if (!m.sourceField || !m.lookupTable) throw new ValidationAppError(`${m.mappingType} mapping for ${m.targetField} needs sourceField and lookupTable`);
          break;
        case 'FORMAT_CONVERSION':
          if (!m.sourceField || !m.format) throw new ValidationAppError(`FORMAT_CONVERSION mapping for ${m.targetField} needs sourceField and format`);
          break;
        case 'CONDITIONAL':
          if (!m.condition) throw new ValidationAppError(`CONDITIONAL mapping for ${m.targetField} needs a condition`);
          this.condition.validate(m.condition);
          break;
        case 'DERIVED_SAFE_EXPRESSION':
          if (!m.derivedFrom?.length) throw new ValidationAppError(`DERIVED_SAFE_EXPRESSION mapping for ${m.targetField} needs derivedFrom`);
          break;
        case 'IGNORE':
        case 'REQUIRED_MANUAL':
          break;
        default:
          throw new ValidationAppError(`Unknown integration mapping type: ${m.mappingType as string}`);
      }
    }
  }

  /** Applies field mappings against one canonical/raw source object,
   * returning the target canonical fields plus a list of REQUIRED_MANUAL
   * fields that still need resolution (spec section 45 — manual
   * matching workbench, not a hard failure at this layer). */
  apply(mappings: IntegrationFieldMapping[], source: Record<string, unknown>, userSuppliedFields: Record<string, unknown> = {}): { target: Record<string, unknown>; requiresManual: string[] } {
    const target: Record<string, unknown> = {};
    const requiresManual: string[] = [];

    // Delegate the primitives Phase 27 already implements safely.
    const delegated: HeaderMappingRule[] = mappings
      .filter((m) => ['DIRECT', 'CONSTANT', 'LOOKUP', 'IGNORE', 'REQUIRED_MANUAL'].includes(m.mappingType))
      .map((m) => ({
        targetField: m.targetField,
        mappingType: m.mappingType === 'DIRECT' ? 'COPY' : m.mappingType === 'IGNORE' ? 'DO_NOT_COPY' : m.mappingType === 'REQUIRED_MANUAL' ? 'USER_REQUIRED' : (m.mappingType as 'CONSTANT' | 'LOOKUP'),
        sourceField: m.sourceField,
        constant: m.constant,
        lookupTable: m.lookupTable,
      }));

    for (const m of mappings.filter((x) => x.mappingType === 'REQUIRED_MANUAL')) {
      if (userSuppliedFields[m.targetField] === undefined) requiresManual.push(m.targetField);
    }

    if (delegated.length > 0) {
      const safeDelegated = delegated.filter((r) => r.mappingType !== 'USER_REQUIRED' || userSuppliedFields[r.targetField] !== undefined);
      Object.assign(target, this.transformationMapping.applyHeaderMapping(safeDelegated, source, { userSuppliedFields }));
    }

    for (const m of mappings) {
      switch (m.mappingType) {
        case 'VALUE_MAP': {
          const key = String(source[m.sourceField!]);
          if (!(key in m.lookupTable!)) throw new ValidationAppError(`VALUE_MAP for ${m.targetField}: no entry for external value '${key}'`);
          target[m.targetField] = m.lookupTable![key];
          break;
        }
        case 'FORMAT_CONVERSION':
          target[m.targetField] = this.convertFormat(source[m.sourceField!], m.format!);
          break;
        case 'CONDITIONAL':
          target[m.targetField] = this.condition.evaluate(m.condition!, source) ? m.whenTrueConstant : m.whenFalseConstant;
          break;
        case 'DERIVED_SAFE_EXPRESSION':
          target[m.targetField] = m.derivedFrom!.map((f) => source[f]).find((v) => v !== undefined && v !== null);
          break;
      }
    }

    return { target, requiresManual };
  }

  async activateVersion(tenantId: string, userId: string, versionId: string) {
    const version = await this.prisma.integrationMappingVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new NotFoundAppError('IntegrationMappingVersion', versionId);
    this.validateFieldMappings((version.fieldMappings as unknown as IntegrationFieldMapping[]) ?? []);
    return this.prisma.runInTransaction(async (tx) => {
      await tx.integrationMappingVersion.updateMany({ where: { tenantId, mappingProfileId: version.mappingProfileId, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
      return tx.integrationMappingVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE', approvedBy: userId } });
    });
  }

  private convertFormat(value: unknown, format: NonNullable<IntegrationFieldMapping['format']>): unknown {
    switch (format) {
      case 'ISO_DATE': {
        const d = new Date(value as string);
        if (Number.isNaN(d.getTime())) throw new ValidationAppError(`Cannot convert '${value}' to an ISO date`);
        return d.toISOString();
      }
      case 'UPPERCASE':
        return String(value).toUpperCase();
      case 'LOWERCASE':
        return String(value).toLowerCase();
      case 'TRIM':
        return String(value).trim();
      case 'FIXED_2_DECIMALS':
        return Number(value).toFixed(2);
    }
  }
}
