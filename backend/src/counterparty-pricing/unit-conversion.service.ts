import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { Decimal } from '@prisma/client/runtime/library';

export interface UnitConversionInput {
  fromUnitId: string;
  toUnitId: string;
  factor: number | Decimal;
  description?: string;
}

/**
 * Phase 3 — Unit Conversion service (section 85).
 * Tenant-scoped conversion factors between units (1 kg = 1000 g).
 */
@Injectable()
export class UnitConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, includeInactive = false) {
    return this.prisma.unitConversion.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { createdAt: 'asc' },
      include: {
        fromUnit: { select: { id: true, code: true, name: true, symbol: true } },
        toUnit: { select: { id: true, code: true, name: true, symbol: true } },
      },
    });
  }

  private async assertUnitExists(tenantId: string, unitId: string) {
    const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id: unitId, tenantId } });
    if (!unit) throw new ValidationAppError('Unit of measure not found');
  }

  async create(tenantId: string, userId: string, input: UnitConversionInput) {
    if (input.fromUnitId === input.toUnitId) {
      throw new ValidationAppError('From and to units must be different');
    }
    await this.assertUnitExists(tenantId, input.fromUnitId);
    await this.assertUnitExists(tenantId, input.toUnitId);

    const factorNum = new Decimal(input.factor.toString());
    if (factorNum.lte(0)) throw new ValidationAppError('Conversion factor must be positive');

    const existing = await this.prisma.unitConversion.findUnique({
      where: { tenantId_fromUnitId_toUnitId: { tenantId, fromUnitId: input.fromUnitId, toUnitId: input.toUnitId } },
    });
    if (existing) throw new ConflictAppError('Conversion already exists for this unit pair');

    const conversion = await this.prisma.unitConversion.create({
      data: {
        tenantId, createdBy: userId, updatedBy: userId,
        fromUnitId: input.fromUnitId, toUnitId: input.toUnitId,
        factor: factorNum, description: input.description,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'UNIT_CONVERSION_CREATED', entityType: 'UnitConversion',
      entityId: conversion.id, action: 'CREATE', userId,
      newValues: { fromUnitId: input.fromUnitId, toUnitId: input.toUnitId },
    });

    return conversion;
  }

  async get(tenantId: string, id: string) {
    const conv = await this.prisma.unitConversion.findFirst({
      where: { id, tenantId },
      include: {
        fromUnit: { select: { id: true, code: true, name: true } },
        toUnit: { select: { id: true, code: true, name: true } },
      },
    });
    if (!conv) throw new NotFoundAppError('UnitConversion', id);
    return conv;
  }

  async update(tenantId: string, id: string, userId: string, expectedVersion: number, patch: Partial<UnitConversionInput>) {
    if (patch.factor !== undefined) {
      const f = new Decimal(patch.factor.toString());
      if (f.lte(0)) throw new ValidationAppError('Conversion factor must be positive');
    }
    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    if (patch.factor !== undefined) updateData.factor = new Decimal(patch.factor.toString());
    if (patch.description !== undefined) updateData.description = patch.description;

    const result = await this.prisma.unitConversion.updateMany({
      where: { id, tenantId, version: expectedVersion }, data: updateData,
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId, eventType: 'UNIT_CONVERSION_UPDATED', entityType: 'UnitConversion',
      entityId: id, action: 'UPDATE', userId, newValues: patch,
    });
    return this.prisma.unitConversion.findUnique({ where: { id } });
  }

  async deactivate(tenantId: string, id: string, userId: string, expectedVersion: number) {
    const conv = await this.get(tenantId, id);
    if (!conv.active) throw new ValidationAppError('Conversion is already inactive');

    const result = await this.prisma.unitConversion.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId, eventType: 'UNIT_CONVERSION_DEACTIVATED', entityType: 'UnitConversion',
      entityId: id, action: 'DEACTIVATE', userId,
    });
    return this.prisma.unitConversion.findUnique({ where: { id } });
  }

  /**
   * Convert a quantity from one unit to another using stored factor.
   * Returns null if no direct conversion exists.
   */
  async convert(tenantId: string, fromUnitId: string, toUnitId: string, quantity: number | Decimal): Promise<Decimal | null> {
    if (fromUnitId === toUnitId) return new Decimal(quantity.toString());
    const conv = await this.prisma.unitConversion.findUnique({
      where: { tenantId_fromUnitId_toUnitId: { tenantId, fromUnitId, toUnitId } },
    });
    if (!conv || !conv.active) return null;
    return new Decimal(quantity.toString()).mul(conv.factor);
  }
}
