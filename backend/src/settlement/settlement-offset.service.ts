import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { SETTLEMENT_OFFSET_TYPE } from './settlement-offset.repository';

const SEQUENCE_PREFIX = 'OFS';

/**
 * SettlementOffsetService (spec sections 41-44, 130, 158). Builds the
 * offset document header + receivable/payable lines from the caller's
 * matched amounts — the actual netting effect happens in
 * `SettlementOffsetPostingHandler` on POST, exactly like every other
 * document in this codebase (draft first, business effect on posting).
 */
@Injectable()
export class SettlementOffsetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.settlementOffset.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementOffset.findFirst({ where: { id, organizationId }, include: { lines: true } });
    if (!row) throw new NotFoundAppError('SettlementOffset', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { counterpartyId: string; currencyId: string; reason?: string; documentDate: string; receivableLines: { openItemId: string; amount: number }[]; payableLines: { openItemId: string; amount: number }[] }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const documentDate = this.parseDate(dto.documentDate);
    const receivableTotal = dto.receivableLines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const payableTotal = dto.payableLines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    if (!receivableTotal.equals(payableTotal)) throw new ValidationAppError('Receivable and payable lines must total the same amount');
    if (receivableTotal.lte(0)) throw new ValidationAppError('Offset amount must be positive');

    // Cross-counterparty is impossible by construction — every open item
    // referenced must belong to this same counterparty (spec section 43).
    const [obligations, payables] = await Promise.all([
      this.prisma.settlementObligation.findMany({ where: { tenantId, id: { in: dto.receivableLines.map((l) => l.openItemId) } } }),
      this.prisma.supplierPayable.findMany({ where: { tenantId, id: { in: dto.payableLines.map((l) => l.openItemId) } } }),
    ]);
    if (obligations.some((o) => o.counterpartyId !== dto.counterpartyId) || payables.some((p) => p.counterpartyId !== dto.counterpartyId)) {
      throw new ValidationAppError('Every open item in an offset must belong to the same counterparty (cross-counterparty offset is disabled by default)');
    }

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SETTLEMENT_OFFSET_TYPE, documentDate, tx);
      const header = await tx.settlementOffset.create({
        data: { tenantId, organizationId, counterpartyId: dto.counterpartyId, amount: receivableTotal.toString(), currencyId: dto.currencyId, reason: dto.reason, number: allocated.formatted, documentDate, createdBy: userId, updatedBy: userId },
      });
      let position = 0;
      for (const l of dto.receivableLines) {
        await tx.settlementOffsetLine.create({ data: { tenantId, offsetId: header.id, position: position++, side: 'RECEIVABLE', openItemType: 'SETTLEMENT_OBLIGATION', openItemId: l.openItemId, amount: l.amount.toString() } });
      }
      for (const l of dto.payableLines) {
        await tx.settlementOffsetLine.create({ data: { tenantId, offsetId: header.id, position: position++, side: 'PAYABLE', openItemType: 'SUPPLIER_PAYABLE', openItemId: l.openItemId, amount: l.amount.toString() } });
      }
      await this.audit.record({ tenantId, eventType: 'SETTLEMENT_OFFSET_CREATED', entityType: SETTLEMENT_OFFSET_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { amount: receivableTotal.toString() } }, tx);
      return tx.settlementOffset.findFirst({ where: { id: header.id }, include: { lines: true } });
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SETTLEMENT_OFFSET_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: SETTLEMENT_OFFSET_TYPE, documentType: SETTLEMENT_OFFSET_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
