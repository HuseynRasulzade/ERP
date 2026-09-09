import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingPostingEngine } from './accounting-posting-engine.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * Manual Operation (spec sections 51-52) — an accountant entering
 * debit/credit lines by hand. Deliberately a thin service: it does NOT
 * duplicate any ledger logic, it only shapes the request into
 * AccountingPostingEngine's draft/post/unpost/reverse commands (spec
 * section 51: "Do not create a second separate ledger engine").
 */
@Injectable()
export class ManualOperationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly charts: ChartOfAccountsService,
    private readonly engine: AccountingPostingEngine,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.journalEntry.findMany({
      where: { tenantId, organizationId, isManual: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId, organizationId, isManual: true },
      include: { lines: { include: { dimensions: true }, orderBy: { sequence: 'asc' } } },
    });
    if (!entry) throw new NotFoundAppError('ManualOperation', id);
    return entry;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { businessDate: string; description?: string; lines: Array<{
      accountId: string;
      side: 'DEBIT' | 'CREDIT';
      amountBase: string;
      transactionCurrencyId?: string;
      amountTransaction?: string;
      exchangeRate?: string;
      quantity?: string;
      quantityUnitId?: string;
      description?: string;
      dimensions?: { dimensionCode: string; referenceId: string }[];
    }> },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.charts.ensureAdopted(tenantId);

    return this.engine.createDraft(tenantId, organizationId, userId, {
      businessDate: parseDate(dto.businessDate),
      description: dto.description,
      lines: dto.lines,
    });
  }

  async post(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.engine.postDraft(tenantId, id, userId, expectedVersion);
  }

  async unpost(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.engine.unpost(tenantId, id, userId, expectedVersion);
  }

  async reverse(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.engine.reverse(tenantId, id, userId, expectedVersion);
  }
}

function parseDate(s: string): Date {
  const d = new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
  return d;
}
