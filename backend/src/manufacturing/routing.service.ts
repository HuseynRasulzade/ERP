import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/** RoutingService (spec sections 16-19). Operations are ordered by
 * `sequence`; a full dependency GRAPH (spec section 19's own "Operation
 * 30 requires 10 and 20") is not built — precedence is purely
 * sequential in this pass (disclosed simplification, see
 * docs/MANUFACTURING.md). Routing is OPTIONAL on a `ProductionOrder` — an
 * order with no routing is treated as a single implicit step. */
@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { code: string; name: string; organizationId?: string }) {
    const row = await this.prisma.routing.create({ data: { tenantId, code: dto.code, name: dto.name, organizationId: dto.organizationId } });
    await this.audit.record({ tenantId, eventType: 'ROUTING_CREATED', entityType: 'ROUTING', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return row;
  }

  async createVersion(tenantId: string, userId: string, routingId: string, dto: { outputProductId: string; versionCode: string; effectiveFrom: string; baseQuantity?: number; operations: { operationCode: string; name: string; sequence: number; workCenterId: string; setupTimeMinutes?: number; runTimePerUnitMinutes?: number; laborStandardHours?: number; machineStandardHours?: number; subcontracted?: boolean; backflushMaterials?: boolean }[] }) {
    const routing = await this.prisma.routing.findFirst({ where: { id: routingId, tenantId } });
    if (!routing) throw new NotFoundAppError('Routing', routingId);
    const sequences = dto.operations.map((o) => o.sequence);
    if (new Set(sequences).size !== sequences.length) throw new ValidationAppError('Routing operation sequences must be unique within a version');

    return this.prisma.runInTransaction(async (tx) => {
      const version = await tx.routingVersion.create({ data: { tenantId, routingId, outputProductId: dto.outputProductId, versionCode: dto.versionCode, effectiveFrom: new Date(dto.effectiveFrom), baseQuantity: (dto.baseQuantity ?? 1).toString(), status: 'ACTIVE' } });
      for (const op of dto.operations) {
        await tx.routingOperation.create({ data: { tenantId, routingVersionId: version.id, operationCode: op.operationCode, name: op.name, sequence: op.sequence, workCenterId: op.workCenterId, setupTimeMinutes: (op.setupTimeMinutes ?? 0).toString(), runTimePerUnitMinutes: (op.runTimePerUnitMinutes ?? 0).toString(), laborStandardHours: op.laborStandardHours?.toString(), machineStandardHours: op.machineStandardHours?.toString(), subcontracted: op.subcontracted ?? false, backflushMaterials: op.backflushMaterials ?? false } });
      }
      await this.audit.record({ tenantId, eventType: 'ROUTING_VERSION_CREATED', entityType: 'ROUTING_VERSION', entityId: version.id, action: 'CREATE', userId, newValues: { versionCode: dto.versionCode, operationCount: dto.operations.length } }, tx);
      return tx.routingVersion.findUniqueOrThrow({ where: { id: version.id }, include: { operations: { orderBy: { sequence: 'asc' } } } });
    });
  }

  async resolveActiveVersion(tenantId: string, outputProductId: string, date: Date) {
    return this.prisma.routingVersion.findFirst({ where: { tenantId, outputProductId, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' }, include: { operations: { orderBy: { sequence: 'asc' } } } });
  }

  get(tenantId: string, versionId: string) {
    return this.prisma.routingVersion.findFirst({ where: { id: versionId, tenantId }, include: { operations: { orderBy: { sequence: 'asc' } } } });
  }
}
