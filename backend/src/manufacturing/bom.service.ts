import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * BOMService (spec sections 4-15). A BOM version is immutable once
 * `APPROVED`/`ACTIVE` (spec section 8) — `amendVersion` always creates a
 * NEW version rather than mutating lines in place. Unit conversion across
 * a BOM line's own unit vs the component's base unit is NOT performed in
 * this build (disclosed simplification, see docs/MANUFACTURING.md) —
 * every quantity is assumed already expressed in the component's base
 * unit.
 */
@Injectable()
export class BOMService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { code: string; name: string; organizationId?: string }) {
    const row = await this.prisma.billOfMaterials.create({ data: { tenantId, code: dto.code, name: dto.name, organizationId: dto.organizationId, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'BOM_CREATED', entityType: 'BILL_OF_MATERIALS', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return row;
  }

  async createVersion(
    tenantId: string,
    userId: string,
    bomId: string,
    dto: { outputProductId: string; versionCode: string; effectiveFrom: string; baseOutputQuantity?: number; baseUnitId: string; productionType?: string; yieldPercentage?: number; lines: { componentProductId: string; quantity: number; unitId: string; scrapFactor?: number; fixedQuantity?: boolean; substitutionGroup?: string; operationSequence?: number; consumptionType?: string; sequence?: number }[] },
  ) {
    const bom = await this.prisma.billOfMaterials.findFirst({ where: { id: bomId, tenantId } });
    if (!bom) throw new NotFoundAppError('BillOfMaterials', bomId);
    if (dto.lines.some((l) => l.componentProductId === dto.outputProductId)) throw new ValidationAppError('A BOM cannot consume its own output product directly (spec section 15 cycle detection)');
    await this.assertNoCycle(tenantId, dto.outputProductId, dto.lines.map((l) => l.componentProductId));

    return this.prisma.runInTransaction(async (tx) => {
      const version = await tx.bOMVersion.create({
        data: {
          tenantId,
          bomId,
          outputProductId: dto.outputProductId,
          versionCode: dto.versionCode,
          effectiveFrom: new Date(dto.effectiveFrom),
          baseOutputQuantity: (dto.baseOutputQuantity ?? 1).toString(),
          baseUnitId: dto.baseUnitId,
          productionType: dto.productionType ?? 'MAKE_TO_STOCK',
          yieldPercentage: (dto.yieldPercentage ?? 100).toString(),
          createdBy: userId,
        },
      });
      for (const line of dto.lines) {
        await tx.bOMLine.create({ data: { tenantId, bomVersionId: version.id, componentProductId: line.componentProductId, quantity: line.quantity.toString(), unitId: line.unitId, scrapFactor: (line.scrapFactor ?? 0).toString(), fixedQuantity: line.fixedQuantity ?? false, substitutionGroup: line.substitutionGroup, operationSequence: line.operationSequence, consumptionType: line.consumptionType ?? 'MATERIAL', sequence: line.sequence ?? 1 } });
      }
      await this.audit.record({ tenantId, eventType: 'BOM_VERSION_CREATED', entityType: 'BOM_VERSION', entityId: version.id, action: 'CREATE', userId, newValues: { versionCode: dto.versionCode, lineCount: dto.lines.length } }, tx);
      return tx.bOMVersion.findUniqueOrThrow({ where: { id: version.id }, include: { lines: true } });
    });
  }

  /** Recursive multi-level cycle detection (spec sections 14-15): does
   * `outputProductId` (directly or transitively, through any ACTIVE
   * version of any BOM whose output is one of `componentIds`) end up
   * requiring itself? */
  private async assertNoCycle(tenantId: string, outputProductId: string, componentIds: string[], visited = new Set<string>()): Promise<void> {
    for (const componentId of componentIds) {
      if (componentId === outputProductId) throw new ValidationAppError(`BOM cycle detected: ${outputProductId} would (in)directly require itself via component ${componentId} (spec section 15)`);
      if (visited.has(componentId)) continue;
      visited.add(componentId);
      const subVersions = await this.prisma.bOMVersion.findMany({ where: { tenantId, outputProductId: componentId, status: { in: ['APPROVED', 'ACTIVE'] } }, include: { lines: true } });
      for (const sub of subVersions) await this.assertNoCycle(tenantId, outputProductId, sub.lines.map((l) => l.componentProductId), visited);
    }
  }

  async approveVersion(tenantId: string, userId: string, versionId: string) {
    const version = await this.prisma.bOMVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new NotFoundAppError('BOMVersion', versionId);
    if (version.status !== 'DRAFT' && version.status !== 'REVIEW') throw new ValidationAppError(`Cannot approve from status ${version.status}`);
    const row = await this.prisma.bOMVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE', approvedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'BOM_VERSION_APPROVED', entityType: 'BOM_VERSION', entityId: versionId, action: 'UPDATE', userId, newValues: {} });
    return row;
  }

  /** Effective-dated resolution (spec section 9) — the version whose
   * window covers `date`, never simply "the latest". */
  async resolveActiveVersion(tenantId: string, outputProductId: string, date: Date) {
    const version = await this.prisma.bOMVersion.findFirst({ where: { tenantId, outputProductId, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' }, include: { lines: true } });
    if (!version) throw new ValidationAppError(`No ACTIVE BOM version for product ${outputProductId} effective on ${date.toISOString().slice(0, 10)}`);
    return version;
  }

  /** Material requirement quantities for a planned output quantity (spec
   * section 30): `required = plannedOutput / baseOutputQuantity × BOM
   * line quantity × (1 + scrapFactor)`, adjusted by BOM yield. Phantom
   * BOM lines (spec section 13) are exploded one level further instead of
   * generating their own requirement row. */
  async explode(tenantId: string, bomVersionId: string, plannedOutputQuantity: Decimal, effectiveDate: Date): Promise<{ componentProductId: string; unitId: string; requiredQuantity: Decimal; sourceBomLineId: string; operationSequence: number | null }[]> {
    const version = await this.prisma.bOMVersion.findFirstOrThrow({ where: { id: bomVersionId, tenantId }, include: { lines: true } });
    const outputRatio = plannedOutputQuantity.dividedBy(version.baseOutputQuantity.toString()).dividedBy(new Decimal(version.yieldPercentage.toString()).dividedBy(100));

    const results: { componentProductId: string; unitId: string; requiredQuantity: Decimal; sourceBomLineId: string; operationSequence: number | null }[] = [];
    for (const line of version.lines) {
      const lineQty = new Decimal(line.quantity.toString()).mul(new Decimal(1).plus(line.scrapFactor.toString()));
      const requiredQuantity = line.fixedQuantity ? lineQty : lineQty.mul(outputRatio);

      if (line.consumptionType === 'PHANTOM') {
        const subVersion = await this.resolveActiveVersion(tenantId, line.componentProductId, effectiveDate);
        const subResults = await this.explode(tenantId, subVersion.id, requiredQuantity, effectiveDate);
        results.push(...subResults);
      } else {
        results.push({ componentProductId: line.componentProductId, unitId: line.unitId, requiredQuantity, sourceBomLineId: line.id, operationSequence: line.operationSequence });
      }
    }
    return results;
  }

  get(tenantId: string, bomId: string) {
    return this.prisma.billOfMaterials.findFirst({ where: { id: bomId, tenantId }, include: { versions: { include: { lines: true } } } });
  }

  list(tenantId: string, organizationId?: string) {
    return this.prisma.billOfMaterials.findMany({ where: { tenantId, active: true, OR: [{ organizationId }, { organizationId: null }] } });
  }
}
