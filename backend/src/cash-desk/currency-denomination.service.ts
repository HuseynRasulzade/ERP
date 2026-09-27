import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';

/**
 * CurrencyDenomination — the banknote/coin face-value catalog a physical
 * cash count's denomination lines are built from (docx spec Phase 15,
 * "Denomination Count"). Tenant-scoped master data, same shape as
 * Currency itself — no organization dimension, no version/optimistic
 * locking (a denomination catalog entry is either active or not).
 */
@Injectable()
export class CurrencyDenominationService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, currencyId?: string, activeOnly = true) {
    return this.prisma.currencyDenomination.findMany({
      where: {
        tenantId,
        ...(currencyId ? { currencyId } : {}),
        ...(activeOnly ? { active: true } : {}),
      },
      orderBy: [{ currencyId: 'asc' }, { faceValue: 'desc' }],
    });
  }

  async create(
    tenantId: string,
    userId: string,
    currencyId: string,
    faceValue: number,
  ) {
    const currency = await this.prisma.currency.findUnique({
      where: { id: currencyId },
    });
    if (!currency) throw new ValidationAppError('Unknown currency');
    const value = new Decimal(faceValue.toString());
    if (!value.isFinite() || value.lte(0))
      throw new ValidationAppError('Face value must be positive');

    const existing = await this.prisma.currencyDenomination.findFirst({
      where: { tenantId, currencyId, faceValue: value.toString() },
    });
    if (existing) {
      if (existing.active)
        throw new ValidationAppError('This denomination already exists');
      return this.prisma.currencyDenomination.update({
        where: { id: existing.id },
        data: { active: true },
      });
    }

    return this.prisma.currencyDenomination.create({
      data: { tenantId, currencyId, faceValue: value, createdBy: userId },
    });
  }

  async deactivate(tenantId: string, id: string) {
    const row = await this.prisma.currencyDenomination.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('CurrencyDenomination', id);
    return this.prisma.currencyDenomination.update({
      where: { id },
      data: { active: false },
    });
  }
}
