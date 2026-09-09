import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const VALID_UNIT_TYPES = ['QUANTITY', 'WEIGHT', 'VOLUME', 'LENGTH', 'AREA', 'TIME'];

export interface UnitOfMeasureInput {
  code: string;
  name: string;
  symbol?: string;
  unitType?: string;
  description?: string;
}

/**
 * Phase 2 — Unit of Measure service (section 79).
 * Tenant-level shared measurement units (kg, piece, liter, etc.).
 * Products reference these units. No conversion factors yet (Phase 3+).
 */
@Injectable()
export class UnitOfMeasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, includeInactive = false) {
    return this.prisma.unitOfMeasure.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  private assertValidType(type?: string) {
    if (type && !VALID_UNIT_TYPES.includes(type)) {
      throw new ValidationAppError(`Unknown unit type: ${type}. Valid types: ${VALID_UNIT_TYPES.join(', ')}`);
    }
  }

  async create(tenantId: string, userId: string, input: UnitOfMeasureInput) {
    this.assertValidType(input.unitType);

    const existing = await this.prisma.unitOfMeasure.findUnique({
      where: { tenantId_code: { tenantId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Unit of measure code already exists: ${input.code}`);

    const unit = await this.prisma.unitOfMeasure.create({
      data: { tenantId, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'UNIT_OF_MEASURE_CREATED',
      entityType: 'UnitOfMeasure',
      entityId: unit.id,
      action: 'CREATE',
      userId,
      newValues: { code: unit.code, name: unit.name },
    });

    return unit;
  }

  async get(tenantId: string, unitId: string) {
    const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id: unitId, tenantId } });
    if (!unit) throw new NotFoundAppError('UnitOfMeasure', unitId);
    return unit;
  }

  async update(
    tenantId: string,
    unitId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<UnitOfMeasureInput>,
  ) {
    this.assertValidType(patch.unitType);

    const result = await this.prisma.unitOfMeasure.updateMany({
      where: { id: unitId, tenantId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'UNIT_OF_MEASURE_UPDATED',
      entityType: 'UnitOfMeasure',
      entityId: unitId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.unitOfMeasure.findUnique({ where: { id: unitId } });
  }

  async deactivate(tenantId: string, unitId: string, userId: string, expectedVersion: number) {
    const unit = await this.get(tenantId, unitId);
    if (!unit.active) throw new ValidationAppError('Unit of measure is already inactive');

    // Check if any products are using this unit
    const productsUsingUnit = await this.prisma.product.count({
      where: { tenantId, baseUnitId: unitId, active: true },
    });
    if (productsUsingUnit > 0) {
      throw new ValidationAppError(`Cannot deactivate unit: ${productsUsingUnit} active products are using it`);
    }

    const result = await this.prisma.unitOfMeasure.updateMany({
      where: { id: unitId, tenantId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'UNIT_OF_MEASURE_DEACTIVATED',
      entityType: 'UnitOfMeasure',
      entityId: unitId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.unitOfMeasure.findUnique({ where: { id: unitId } });
  }
}
