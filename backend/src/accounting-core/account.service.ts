import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import {
  ConflictAppError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { AccountClass, NormalBalance } from '@prisma/client';

export interface CreateAccountInput {
  code: string;
  name: string;
  description?: string;
  accountClass: AccountClass;
  normalBalance: NormalBalance;
  parentAccountId?: string;
  postingAllowed?: boolean;
  currencyTracking?: boolean;
  quantityTracking?: boolean;
  organizationId?: string;
}

/**
 * Account CRUD on top of a tenant's adopted chart (spec sections 20-24,
 * 78-81). Custom accounts (organization admins extending 205 -> 205-01
 * etc, spec section 78) go through `create`; the AZ_STANDARD seed accounts
 * themselves are only ever created by ChartOfAccountsService.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly charts: ChartOfAccountsService,
  ) {}

  async list(tenantId: string, includeInactive = false) {
    await this.charts.ensureAdopted(tenantId);
    return this.prisma.account.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ code: 'asc' }],
    });
  }

  async get(tenantId: string, id: string) {
    const account = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundAppError('Account', id);
    return account;
  }

  async getByCode(tenantId: string, code: string) {
    const chart = await this.charts.getTenantChart(tenantId);
    const account = await this.prisma.account.findUnique({
      where: { tenantId_chartOfAccountsId_code: { tenantId, chartOfAccountsId: chart.id, code } },
    });
    if (!account) throw new NotFoundAppError('Account', code);
    return account;
  }

  async create(tenantId: string, userId: string, input: CreateAccountInput) {
    const chart = await this.charts.getTenantChart(tenantId);

    const existing = await this.prisma.account.findUnique({
      where: { tenantId_chartOfAccountsId_code: { tenantId, chartOfAccountsId: chart.id, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Account code already exists: ${input.code}`);

    let parent: { id: string; financialStatementSectionId: string | null; financialStatementGroupId: string | null } | null = null;
    if (input.parentAccountId) {
      parent = await this.prisma.account.findFirst({ where: { id: input.parentAccountId, tenantId } });
      if (!parent) throw new NotFoundAppError('Account', input.parentAccountId);
    }

    const account = await this.prisma.account.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        chartOfAccountsId: chart.id,
        parentAccountId: input.parentAccountId,
        financialStatementSectionId: parent?.financialStatementSectionId,
        financialStatementGroupId: parent?.financialStatementGroupId,
        code: input.code,
        name: input.name,
        description: input.description,
        accountClass: input.accountClass,
        normalBalance: input.normalBalance,
        postingAllowed: input.postingAllowed ?? true,
        currencyTracking: input.currencyTracking ?? false,
        quantityTracking: input.quantityTracking ?? false,
        systemAccount: false,
        customizable: true,
        systemSeed: false,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'ACCOUNT_CREATED',
      entityType: 'Account',
      entityId: account.id,
      action: 'CREATE',
      userId,
      newValues: { code: account.code, name: account.name },
    });

    return account;
  }

  async update(
    tenantId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    patch: { name?: string; description?: string; active?: boolean },
  ) {
    const account = await this.get(tenantId, id);
    if (account.version !== expectedVersion) throw new ConflictAppError('The account has been changed by another user');

    // Section 81: identity-changing fields are frozen once a system-seeded
    // account exists; only name/description/active may move, and only
    // through this audited path.
    const result = await this.prisma.account.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConflictAppError('The account has been changed by another user');

    await this.audit.record({
      tenantId,
      eventType: account.active && patch.active === false ? 'ACCOUNT_DEACTIVATED' : 'ACCOUNT_UPDATED',
      entityType: 'Account',
      entityId: id,
      action: 'UPDATE',
      userId,
      oldValues: { name: account.name, active: account.active },
      newValues: patch,
    });

    return this.get(tenantId, id);
  }

  /** Hierarchy children — used by the Trial Balance rollup (spec section 69). */
  async childrenOf(tenantId: string, parentAccountId: string) {
    return this.prisma.account.findMany({ where: { tenantId, parentAccountId } });
  }
}
