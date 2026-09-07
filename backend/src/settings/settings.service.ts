import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SettingScopeType = 'SYSTEM' | 'TENANT' | 'ORGANIZATION';

/**
 * Scoped, effective-dated settings (section 32/33). Callers use the typed
 * getters below (`getTenantSetting`, ...) instead of reaching into a random
 * JSON blob scattered through the codebase.
 *
 * A new row is inserted for every change rather than mutating in place, so
 * a historical transaction dated before a configuration change can resolve
 * the version that was valid on ITS business date (section 66), not
 * whatever is current today.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async setTenantSetting(tenantId: string, key: string, value: unknown, effectiveFrom: Date, createdBy?: string) {
    // Close the previous version's validity window at the new effective date.
    await this.prisma.setting.updateMany({
      where: { scope: 'TENANT', scopeId: tenantId, key, validTo: null },
      data: { validTo: effectiveFrom },
    });

    return this.prisma.setting.create({
      data: {
        scope: 'TENANT',
        scopeId: tenantId,
        key,
        value: value as any,
        validFrom: effectiveFrom,
        createdBy,
      },
    });
  }

  async setSystemSetting(key: string, value: unknown, effectiveFrom: Date) {
    await this.prisma.setting.updateMany({
      where: { scope: 'SYSTEM', scopeId: null, key, validTo: null },
      data: { validTo: effectiveFrom },
    });

    return this.prisma.setting.create({
      data: { scope: 'SYSTEM', scopeId: null, key, value: value as any, validFrom: effectiveFrom },
    });
  }

  /** Resolves the value effective on `asOf` (defaults to now), falling back
   * TENANT -> SYSTEM so a tenant only overrides what it explicitly sets. */
  async getTenantSetting<T = unknown>(tenantId: string, key: string, asOf: Date = new Date()): Promise<T | undefined> {
    const tenantSetting = await this.resolve('TENANT', tenantId, key, asOf);
    if (tenantSetting !== undefined) return tenantSetting as T;
    return (await this.resolve('SYSTEM', null, key, asOf)) as T | undefined;
  }

  private async resolve(scope: SettingScopeType, scopeId: string | null, key: string, asOf: Date) {
    const setting = await this.prisma.setting.findFirst({
      where: {
        scope,
        scopeId,
        key,
        validFrom: { lte: asOf },
        OR: [{ validTo: null }, { validTo: { gt: asOf } }],
      },
      orderBy: { validFrom: 'desc' },
    });
    return setting?.value;
  }
}
