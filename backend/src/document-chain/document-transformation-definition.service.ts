import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { WorkflowConditionService, ConditionNode } from '../workflow/workflow-condition.service';
import { TransformationMappingService, HeaderMappingRule, LineMappingRule } from './transformation-mapping.service';

export interface CreateTransformationInput {
  code: string;
  sourceDocumentType: string;
  targetDocumentType: string;
  transformationCategory?: string;
  ownerModule?: string;
}

export interface CreateTransformationVersionInput {
  organizationId?: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  priority?: number;
  headerMapping?: HeaderMappingRule[];
  lineMapping?: LineMappingRule[];
  eligibilityRules?: ConditionNode[];
  consumptionMetric?: string;
  commitState?: string;
  claimPolicy?: string;
  claimTtlMinutes?: number;
  tolerancePolicy?: { type: 'NONE' | 'PERCENT' | 'AMOUNT' | 'APPROVAL_REQUIRED'; value?: number };
}

/**
 * DocumentTransformationDefinitionService (docx spec Phase 27, sections
 * 9-20). Owns the GOVERNED, versioned, effective-dated configuration for
 * one source->target transformation. The version is immutable once
 * ACTIVE (spec section 15) — editing an active version is rejected;
 * callers must create a new version instead, mirroring
 * `WorkflowDefinitionService`'s own effective-dated version pattern from
 * Phase 26 (`resolveActiveVersion` here is a direct structural echo of
 * that service's own method of the same name).
 */
@Injectable()
export class DocumentTransformationDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly condition: WorkflowConditionService,
    private readonly mapping: TransformationMappingService,
  ) {}

  list(tenantId: string) {
    return this.prisma.documentTransformationDefinition.findMany({ where: { tenantId }, include: { versions: true } });
  }

  async createDefinition(tenantId: string, input: CreateTransformationInput) {
    if (!input.code || !input.sourceDocumentType || !input.targetDocumentType) {
      throw new ValidationAppError('code, sourceDocumentType and targetDocumentType are required');
    }
    return this.prisma.documentTransformationDefinition.create({
      data: {
        tenantId,
        code: input.code,
        sourceDocumentType: input.sourceDocumentType,
        targetDocumentType: input.targetDocumentType,
        transformationCategory: input.transformationCategory ?? 'QUANTITY_BASED',
        ownerModule: input.ownerModule,
      },
    });
  }

  async createVersion(tenantId: string, userId: string, transformationId: string, input: CreateTransformationVersionInput) {
    const definition = await this.prisma.documentTransformationDefinition.findFirst({ where: { id: transformationId, tenantId } });
    if (!definition) throw new NotFoundAppError('DocumentTransformationDefinition', transformationId);

    if (input.headerMapping) this.mapping.validateHeaderMapping(input.headerMapping);
    if (input.lineMapping) this.mapping.validateLineMapping(input.lineMapping);
    (input.eligibilityRules ?? []).forEach((rule) => this.condition.validate(rule));

    const last = await this.prisma.documentTransformationVersion.findFirst({
      where: { tenantId, transformationId },
      orderBy: { version: 'desc' },
    });

    return this.prisma.documentTransformationVersion.create({
      data: {
        tenantId,
        transformationId,
        version: (last?.version ?? 0) + 1,
        organizationId: input.organizationId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        priority: input.priority ?? 100,
        headerMapping: (input.headerMapping ?? []) as object,
        lineMapping: (input.lineMapping ?? []) as object,
        eligibilityRules: (input.eligibilityRules ?? []) as object,
        consumptionMetric: input.consumptionMetric ?? 'QUANTITY',
        commitState: input.commitState ?? 'ON_POST',
        claimPolicy: input.claimPolicy ?? 'SOFT_CLAIM',
        claimTtlMinutes: input.claimTtlMinutes,
        tolerancePolicy: (input.tolerancePolicy ?? null) as object | undefined,
        createdBy: userId,
        status: 'DRAFT',
      },
    });
  }

  /** Activation is a one-way door (spec section 15): once ACTIVE, the
   * mapping/eligibility/consumption configuration on this version row is
   * frozen — a later change always means a NEW version. Retires the
   * prior ACTIVE version for the same (transformation, organization)
   * scope, mirroring `WorkflowDefinitionService.activateVersion`. */
  async activateVersion(tenantId: string, userId: string, versionId: string) {
    const version = await this.prisma.documentTransformationVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new NotFoundAppError('DocumentTransformationVersion', versionId);
    if (version.status === 'ACTIVE') return version;
    if (version.status === 'RETIRED' || version.status === 'CANCELLED') {
      throw new ConflictAppError(`Version ${versionId} is ${version.status} and cannot be activated`);
    }

    this.mapping.validateHeaderMapping((version.headerMapping as unknown as HeaderMappingRule[]) ?? []);
    this.mapping.validateLineMapping((version.lineMapping as unknown as LineMappingRule[]) ?? []);
    ((version.eligibilityRules as unknown as ConditionNode[]) ?? []).forEach((rule) => this.condition.validate(rule));

    return this.prisma.runInTransaction(async (tx) => {
      await tx.documentTransformationVersion.updateMany({
        where: { tenantId, transformationId: version.transformationId, organizationId: version.organizationId, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      });
      return tx.documentTransformationVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE', approvedBy: userId } });
    });
  }

  /** Resolves the single applicable ACTIVE version for a source/target
   * pair as of a business date — org-specific version wins over a
   * tenant-wide one at equal priority, exactly as
   * `WorkflowDefinitionService.resolveActiveVersion` resolves workflow
   * versions (spec section 12's own "most specific wins" rule). */
  async resolveActiveVersion(tenantId: string, sourceDocumentType: string, targetDocumentType: string, organizationId: string | null, asOfDate: Date) {
    const definition = await this.prisma.documentTransformationDefinition.findFirst({ where: { tenantId, sourceDocumentType, targetDocumentType, active: true } });
    if (!definition) throw new NotFoundAppError('DocumentTransformationDefinition', `${sourceDocumentType}->${targetDocumentType}`);

    const candidates = await this.prisma.documentTransformationVersion.findMany({
      where: {
        tenantId,
        transformationId: definition.id,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
    });
    const scoped = candidates.filter((c) => c.organizationId === organizationId);
    const pool = scoped.length > 0 ? scoped : candidates.filter((c) => c.organizationId === null);
    if (pool.length === 0) throw new NotFoundAppError('DocumentTransformationVersion', `active version for ${sourceDocumentType}->${targetDocumentType}`);

    pool.sort((a, b) => b.priority - a.priority || b.version - a.version);
    return { definition, version: pool[0] };
  }
}
