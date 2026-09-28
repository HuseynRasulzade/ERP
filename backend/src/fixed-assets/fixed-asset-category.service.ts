import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { CreateFixedAssetCategoryDto } from './dto/fixed-asset.dto';

/** FixedAssetCategory — tenant-wide master data (spec section 78), same
 * shape as ResponsiblePerson/CurrencyDenomination: no organization
 * dimension. Category defaults seed a NEW asset's parameters; changing a
 * category's defaults later never retroactively touches an existing
 * asset's own frozen parameters (spec section 79). */
@Injectable()
export class FixedAssetCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, activeOnly = true) {
    return this.prisma.fixedAssetCategory.findMany({
      where: { tenantId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.fixedAssetCategory.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('FixedAssetCategory', id);
    return row;
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateFixedAssetCategoryDto,
  ) {
    const existing = await this.prisma.fixedAssetCategory.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (existing)
      throw new ValidationAppError(`Category code ${dto.code} already exists`);
    return this.prisma.fixedAssetCategory.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        defaultUsefulLifeMonths: dto.defaultUsefulLifeMonths,
        defaultDepreciationMethod:
          dto.defaultDepreciationMethod ?? 'STRAIGHT_LINE',
        defaultResidualValue: new Decimal(
          dto.defaultResidualValue?.toString() ?? '0',
        ),
        capitalizationThreshold: new Decimal(
          dto.capitalizationThreshold?.toString() ?? '0',
        ),
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async deactivate(tenantId: string, id: string, userId: string) {
    const row = await this.get(tenantId, id);
    return this.prisma.fixedAssetCategory.update({
      where: { id: row.id },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
  }
}
