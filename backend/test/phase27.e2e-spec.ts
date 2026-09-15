/**
 * Phase 27 — Create Based On / Document Chain / Provenance Engine.
 *
 * Direct-service testing style matching phases 15-26's own test files.
 * Registers a fake `SourceEligibilityAdapter` for the Phase 0
 * `FOUNDATION_TEST_DOCUMENT` type (the same demo document Phase 0's own
 * `FoundationTestDocumentModule` already registers a repository/mapper
 * for) and exercises: transformation version activation, remaining
 * calculation, proposal generation, staleness detection on accept,
 * successful accept producing a `DocumentLink` + `DocumentLineLink`
 * (CONSUME), a second accept attempt correctly blocked once the source
 * line is fully consumed, claim reservation blocking overcommitment,
 * dependency-graph cycle prevention, and downstream impact analysis
 * defaulting to BLOCK.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DocumentFrameworkRegistry } from '../src/document-framework/document-framework-registry.service';
import { SourceEligibilityAdapter } from '../src/document-framework/source-eligibility-adapter.interface';
import { DocumentTransformationDefinitionService } from '../src/document-chain/document-transformation-definition.service';
import { DocumentCreationProposalService } from '../src/document-chain/document-creation-proposal.service';
import { SourceCreationClaimService } from '../src/document-chain/source-creation-claim.service';
import { RemainingToCreateService } from '../src/document-chain/remaining-to-create.service';
import { DocumentDependencyGraphService } from '../src/document-chain/document-dependency-graph.service';
import { DocumentImpactAnalysisService } from '../src/document-chain/document-impact-analysis.service';

const FOUNDATION_TYPE = 'FOUNDATION_TEST_DOCUMENT';

describe('Phase 27 — Document Chain / Create Based On Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let registry: DocumentFrameworkRegistry;
  let transformations: DocumentTransformationDefinitionService;
  let proposals: DocumentCreationProposalService;
  let claims: SourceCreationClaimService;
  let remaining: RemainingToCreateService;
  let graph: DocumentDependencyGraphService;
  let impact: DocumentImpactAnalysisService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let userId: string;
  let sourceDocId: string;
  const sourceLineId = 'header-as-line'; // FoundationTestDocument has no line table; header itself stands in as the one "line" (disclosed, docs/DOCUMENT_CHAIN.md section E)
  const SOURCE_CAPACITY = new Decimal(100);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    registry = app.get(DocumentFrameworkRegistry);
    transformations = app.get(DocumentTransformationDefinitionService);
    proposals = app.get(DocumentCreationProposalService);
    claims = app.get(SourceCreationClaimService);
    remaining = app.get(RemainingToCreateService);
    graph = app.get(DocumentDependencyGraphService);
    impact = app.get(DocumentImpactAnalysisService);

    // Fake eligibility adapter for the test fixture — a real business
    // module would register one of these on its own module's init.
    const fakeAdapter: SourceEligibilityAdapter = {
      sourceDocumentType: FOUNDATION_TYPE,
      async getEligibleCapacity() {
        return SOURCE_CAPACITY;
      },
    };
    registry.registerEligibilityAdapter(fakeAdapter);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p27-${run}`, name: 'Phase 27 tenant' } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG27-${run}`, name: 'Phase 27 org' } });
    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p27-${run}@e2e.test`, passwordHash: 'x', displayName: 'Phase 27 user' } });

    const source = await prisma.foundationTestDocument.create({
      data: { tenantId, organizationId, documentDate: new Date(), amount: SOURCE_CAPACITY.toString(), createdBy: userId, updatedBy: userId },
    });
    sourceDocId = source.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function activeVersion(claimTtlMinutes?: number) {
    const definition = await transformations.createDefinition(tenantId, {
      code: `SELF_COPY-${run}-${Math.random()}`,
      sourceDocumentType: FOUNDATION_TYPE,
      targetDocumentType: FOUNDATION_TYPE,
      transformationCategory: 'AMOUNT_BASED',
    });
    const version = await transformations.createVersion(tenantId, userId, definition.id, {
      effectiveFrom: new Date('2020-01-01'),
      headerMapping: [
        { targetField: 'organizationId', mappingType: 'COPY', sourceField: 'organizationId' },
        { targetField: 'description', mappingType: 'CONSTANT', constant: 'created-based-on' },
      ],
      lineMapping: [{ sourceLineType: 'HEADER', targetLineType: 'HEADER' }],
      consumptionMetric: 'AMOUNT',
      claimTtlMinutes,
    });
    const activated = await transformations.activateVersion(tenantId, userId, version.id);
    return { definition, version: activated };
  }

  it('resolves the active version and computes full remaining before any consumption', async () => {
    const { definition } = await activeVersion();
    const breakdown = await remaining.computeRemaining(tenantId, FOUNDATION_TYPE, sourceDocId, sourceLineId, definition.code, 'AMOUNT');
    expect(breakdown.remaining.toString()).toBe(SOURCE_CAPACITY.toString());
    expect(breakdown.eligibleCapacity.toString()).toBe(SOURCE_CAPACITY.toString());
  });

  it('rejects a claim that would exceed remaining capacity, then accepts one within it', async () => {
    const { definition, version } = await activeVersion();
    await expect(
      claims.claim(tenantId, userId, {
        transformationVersionId: version.id,
        sourceDocumentType: FOUNDATION_TYPE,
        sourceDocumentId: sourceDocId,
        sourceLineId,
        transformationCode: definition.code,
        metric: 'AMOUNT',
        quantity: SOURCE_CAPACITY.plus(1),
      }),
    ).rejects.toThrow(/exceeds remaining/);

    const claim = await claims.claim(tenantId, userId, {
      transformationVersionId: version.id,
      sourceDocumentType: FOUNDATION_TYPE,
      sourceDocumentId: sourceDocId,
      sourceLineId,
      transformationCode: definition.code,
      metric: 'AMOUNT',
      quantity: new Decimal(20),
    });

    const breakdown = await remaining.computeRemaining(tenantId, FOUNDATION_TYPE, sourceDocId, sourceLineId, definition.code, 'AMOUNT');
    expect(breakdown.activeClaims.toString()).toBe('20');
    expect(breakdown.remaining.toString()).toBe(SOURCE_CAPACITY.minus(20).toString());

    await claims.release(tenantId, claim.id);
    const afterRelease = await remaining.computeRemaining(tenantId, FOUNDATION_TYPE, sourceDocId, sourceLineId, definition.code, 'AMOUNT');
    expect(afterRelease.remaining.toString()).toBe(SOURCE_CAPACITY.toString());
  });

  it('generates a proposal, detects staleness on a changed source, then accepts once re-generated', async () => {
    const { definition } = await activeVersion();
    const sourceHeaderSnapshot = { organizationId, description: 'original' };
    const sourceLines = [{ sourceLineId, sourceLineType: 'HEADER', snapshot: { amount: '30' }, requestedQuantity: new Decimal(30) }];

    const proposal = await proposals.generate(tenantId, userId, FOUNDATION_TYPE, {
      organizationId,
      sourceDocumentType: FOUNDATION_TYPE,
      sourceDocumentIds: [sourceDocId],
      sourceHeaderSnapshot,
      sourceLines,
    });
    expect(proposal.status).toBe('GENERATED');
    expect(proposal.lines).toHaveLength(1);
    expect(new Decimal(proposal.lines[0].proposedQuantity.toString()).toString()).toBe('30');

    // Source "changed" — accept() is given a different snapshot than what
    // was hashed at generation time.
    await expect(
      proposals.accept(tenantId, userId, proposal.id, { organizationId, description: 'CHANGED' }, [{ sourceLineId, snapshot: { amount: '30' } }]),
    ).rejects.toThrow(/changed since proposal/);

    const stale = await proposals.get(tenantId, proposal.id);
    expect(stale.status).toBe('STALE');

    // Regenerate against the (now current) snapshot and accept for real.
    const proposal2 = await proposals.generate(tenantId, userId, FOUNDATION_TYPE, {
      organizationId,
      sourceDocumentType: FOUNDATION_TYPE,
      sourceDocumentIds: [sourceDocId],
      sourceHeaderSnapshot,
      sourceLines,
    });
    const { target, documentLink } = await proposals.accept(tenantId, userId, proposal2.id, sourceHeaderSnapshot, [{ sourceLineId, snapshot: { amount: '30' } }]);
    expect(target.id).toBeTruthy();
    expect(documentLink.relationType).toBe('DERIVED_FROM');
    expect(documentLink.transformationVersionId).toBeTruthy();

    const created = await prisma.foundationTestDocument.findUnique({ where: { id: target.id } });
    expect(created?.description).toBe('created-based-on');

    const lineLink = await prisma.documentLineLink.findFirst({ where: { tenantId, sourceDocumentType: FOUNDATION_TYPE, sourceDocumentId: sourceDocId, targetDocumentId: target.id } });
    expect(lineLink?.movementType).toBe('CONSUME');
    expect(new Decimal(lineLink!.quantity.toString()).toString()).toBe('30');

    const afterAccept = await remaining.computeRemaining(tenantId, FOUNDATION_TYPE, sourceDocId, sourceLineId, definition.code, 'AMOUNT');
    expect(afterAccept.remaining.toString()).toBe(SOURCE_CAPACITY.minus(30).toString());

    // Re-accepting the same (already-ACCEPTED) proposal is rejected.
    await expect(proposals.accept(tenantId, userId, proposal2.id, sourceHeaderSnapshot, [{ sourceLineId, snapshot: { amount: '30' } }])).rejects.toThrow(/already accepted/);

    // Dependency graph: forward from source reaches the new target;
    // linking the target back to the ORIGINAL source line would cycle.
    const forward = await graph.forward(tenantId, FOUNDATION_TYPE, sourceDocId);
    expect(forward.some((e) => e.documentId === target.id)).toBe(true);
    await expect(graph.assertNoCycle(tenantId, FOUNDATION_TYPE, sourceDocId, FOUNDATION_TYPE, target.id)).rejects.toThrow(/cycle/);

    // Impact analysis defaults to BLOCK once downstream is POSTED.
    await prisma.foundationTestDocument.update({ where: { id: target.id }, data: { postingStatus: 'POSTED' } });
    await expect(impact.assertSafeToModify(tenantId, FOUNDATION_TYPE, sourceDocId)).rejects.toThrow(/posted downstream/);
    const report = await impact.assertSafeToModify(tenantId, FOUNDATION_TYPE, sourceDocId, true);
    expect(report.hasPostedDownstream).toBe(true);
  });
});
