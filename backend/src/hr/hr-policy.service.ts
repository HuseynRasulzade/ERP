import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { ConflictAppError, ErrorCode, HrRuleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { DEFAULT_HR_CATALOGS, DEFAULT_HR_POLICY, HR_POLICY_SETTING_KEY, HrCatalogType, HrPolicy } from './hr.constants';
import { fmtHr, parseHrDate, todayHr } from './hr-date.util';

/**
 * HR configuration: policy (tenant setting `hr.policy`, effective-dated via
 * the Phase 0 SettingsService — never a parallel config store), configurable
 * catalogs (termination reasons, leave/absence types ...) and the optional
 * HR close-period foundation (spec 124/125).
 */
@Injectable()
export class HrPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async getPolicy(tenantId: string): Promise<HrPolicy> {
    const stored = await this.settings.getTenantSetting<Partial<HrPolicy>>(tenantId, HR_POLICY_SETTING_KEY);
    return { ...DEFAULT_HR_POLICY, ...(stored ?? {}) };
  }

  async updatePolicy(tenantId: string, userId: string, patch: Partial<HrPolicy>) {
    const current = await this.getPolicy(tenantId);
    const allowed = Object.keys(DEFAULT_HR_POLICY);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (!allowed.includes(k)) throw new ValidationAppError(`Unknown HR policy key: ${k}`);
      clean[k] = v;
    }
    const next = { ...current, ...clean } as HrPolicy;
    if (!['BLOCK', 'WARNING', 'APPROVAL_REQUIRED', 'ALLOW'].includes(next.overstaffPolicy)) throw new ValidationAppError('overstaffPolicy must be BLOCK|WARNING|APPROVAL_REQUIRED|ALLOW');
    if (!['BLOCK', 'WARNING', 'ALLOW'].includes(next.duplicateEmploymentPolicy)) throw new ValidationAppError('duplicateEmploymentPolicy must be BLOCK|WARNING|ALLOW');
    if (!(Number(next.maxEmploymentFte) > 0) || !(Number(next.maxAggregateFte) >= Number(next.maxEmploymentFte))) {
      throw new ValidationAppError('maxEmploymentFte must be > 0 and maxAggregateFte >= maxEmploymentFte');
    }
    await this.settings.setTenantSetting(tenantId, HR_POLICY_SETTING_KEY, next, todayHr(), userId);
    await this.audit.record({ tenantId, eventType: 'HR_POLICY_CHANGED', entityType: 'HR_POLICY', entityId: tenantId, action: 'UPDATE', userId, oldValues: current, newValues: next });
    return next;
  }

  // ---------------------------------------------------------------- catalogs

  async ensureCatalogs(tenantId: string) {
    const count = await this.prisma.hrCatalogItem.count({ where: { tenantId, isSystem: true } });
    const expected = Object.values(DEFAULT_HR_CATALOGS).reduce((n, items) => n + items.length, 0);
    if (count >= expected) return;
    const data = Object.entries(DEFAULT_HR_CATALOGS).flatMap(([catalogType, items]) =>
      items.map((i) => ({ tenantId, catalogType, code: i.code, name: i.name, nameAz: i.nameAz, isSystem: true, metadata: (i.metadata ?? undefined) as any })),
    );
    await this.prisma.hrCatalogItem.createMany({ data, skipDuplicates: true });
  }

  async listCatalog(tenantId: string, catalogType: string) {
    await this.ensureCatalogs(tenantId);
    return this.prisma.hrCatalogItem.findMany({ where: { tenantId, catalogType }, orderBy: [{ isSystem: 'desc' }, { code: 'asc' }] });
  }

  async addCatalogItem(tenantId: string, userId: string, catalogType: string, dto: { code: string; name: string; nameAz?: string; metadata?: Record<string, unknown> }) {
    if (!Object.values(HrCatalogType).includes(catalogType as any)) throw new ValidationAppError(`Unknown HR catalog: ${catalogType}`);
    await this.ensureCatalogs(tenantId);
    const existing = await this.prisma.hrCatalogItem.findUnique({ where: { tenantId_catalogType_code: { tenantId, catalogType, code: dto.code } } });
    if (existing) throw new ConflictAppError(`${catalogType} code already exists: ${dto.code}`);
    const row = await this.prisma.hrCatalogItem.create({ data: { tenantId, catalogType, code: dto.code, name: dto.name, nameAz: dto.nameAz, metadata: dto.metadata as any } });
    await this.audit.record({ tenantId, eventType: 'HR_CATALOG_ITEM_CREATED', entityType: 'HR_CATALOG_ITEM', entityId: row.id, action: 'CREATE', userId, newValues: row });
    return row;
  }

  /** Validates that `code` is an active item of `catalogType`. */
  async assertCatalogCode(tenantId: string, catalogType: string, code: string, client?: PrismaTransactionClient) {
    await this.ensureCatalogs(tenantId);
    const db = client ?? this.prisma;
    const item = await db.hrCatalogItem.findUnique({ where: { tenantId_catalogType_code: { tenantId, catalogType, code } } });
    if (!item || !item.active) throw new ValidationAppError(`Unknown or inactive ${catalogType.toLowerCase().replace(/_/g, ' ')} '${code}'`);
    return item;
  }

  // ---------------------------------------------------------- HR periods

  listPeriods(tenantId: string) {
    return this.prisma.hrPeriod.findMany({ where: { tenantId }, orderBy: { periodStart: 'desc' } });
  }

  async createPeriod(tenantId: string, userId: string, dto: { organizationId?: string; periodStart: string; periodEnd: string }) {
    const periodStart = parseHrDate(dto.periodStart, 'periodStart');
    const periodEnd = parseHrDate(dto.periodEnd, 'periodEnd');
    if (periodEnd < periodStart) throw new ValidationAppError('periodEnd must be on or after periodStart');
    const row = await this.prisma.hrPeriod.create({ data: { tenantId, organizationId: dto.organizationId ?? null, periodStart, periodEnd } });
    await this.audit.record({ tenantId, eventType: 'HR_PERIOD_CREATED', entityType: 'HR_PERIOD', entityId: row.id, action: 'CREATE', userId, newValues: row });
    return row;
  }

  async setPeriodStatus(tenantId: string, userId: string, id: string, status: 'OPEN' | 'CLOSED') {
    const row = await this.prisma.hrPeriod.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('HrPeriod', id);
    const updated = await this.prisma.hrPeriod.update({
      where: { id },
      data: { status, closedAt: status === 'CLOSED' ? new Date() : null, closedBy: status === 'CLOSED' ? userId : null },
    });
    await this.audit.record({ tenantId, eventType: status === 'CLOSED' ? 'HR_PERIOD_CLOSED' : 'HR_PERIOD_REOPENED', entityType: 'HR_PERIOD', entityId: id, action: status, userId, oldValues: { status: row.status }, newValues: { status } });
    return updated;
  }

  /** Blocks an HR change effective inside a CLOSED HR period (tenant-wide
   * or the organization's own). Independent of AccountingPeriod (spec 125). */
  async assertHrDateOpen(tenantId: string, organizationId: string | null, date: Date, client?: PrismaTransactionClient) {
    const db = client ?? this.prisma;
    const closed = await db.hrPeriod.findFirst({
      where: {
        tenantId,
        status: 'CLOSED',
        periodStart: { lte: date },
        periodEnd: { gte: date },
        OR: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])],
      },
    });
    if (closed) {
      throw new HrRuleError(
        ErrorCode.HR_PERIOD_CLOSED,
        `HR period ${fmtHr(closed.periodStart)}–${fmtHr(closed.periodEnd)} is closed; an HR change effective ${fmtHr(date)} cannot be posted`,
        409,
      );
    }
  }
}
