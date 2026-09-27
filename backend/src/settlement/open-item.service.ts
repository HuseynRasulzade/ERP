import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface OpenItemView {
  id: string;
  counterpartyId: string;
  itemType: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber: string | null;
  sourceDate: string;
  dueDate: string | null;
  currencyId: string | null;
  originalAmount: string;
  remainingAmount: string;
  status: string; // OVERDUE computed live, never stored
  overdueDays: number;
  disputedAmount: string;
  blockedForPayment: boolean;
}

const EPSILON = new Decimal('0.005');

/**
 * OpenItemService — read side of `SettlementOpenItem` (spec sections
 * 6-7). `OVERDUE` is never a stored status (spec section 7: "OVERDUE
 * ayrıca manually set edilən status olmamalıdır") — computed live from
 * `dueDate` + `remainingAmount` every time an item is read.
 */
@Injectable()
export class OpenItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    filter: { counterpartyId?: string; itemType?: string; status?: string; includeSettled?: boolean } = {},
  ): Promise<OpenItemView[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.settlementOpenItem.findMany({
      where: {
        tenantId,
        organizationId,
        ...(filter.counterpartyId ? { counterpartyId: filter.counterpartyId } : {}),
        ...(filter.itemType ? { itemType: filter.itemType } : {}),
        ...(filter.includeSettled ? {} : { status: { notIn: ['SETTLED', 'CANCELLED', 'WRITTEN_OFF'] } }),
      },
      orderBy: [{ dueDate: 'asc' }, { sourceDate: 'asc' }],
    });
    return rows.map(toView).filter((r) => !filter.status || r.status === filter.status);
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string): Promise<OpenItemView> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementOpenItem.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('SettlementOpenItem', id);
    return toView(row);
  }

  async forSourceDocument(tenantId: string, organizationId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<OpenItemView[]> {
    const rows = await this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, sourceDocumentType, sourceDocumentId }, orderBy: { scheduleLineSequence: 'asc' } });
    return rows.map(toView);
  }

  /** Total outstanding for one counterparty, one item type — a live sum,
   * never a stored running balance (spec section 80-81). */
  async balance(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, itemType: string): Promise<string> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, counterpartyId, itemType, status: { notIn: ['CANCELLED'] } } });
    return rows.reduce((sum, r) => sum.plus(r.remainingAmount.toString()), new Decimal(0)).toFixed(2);
  }

  /** `CounterpartySettlementBalance` projection (spec section 81/126) —
   * receivable/payable/advance net position for one counterparty. */
  async netPosition(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, counterpartyId, status: { notIn: ['CANCELLED'] } } });
    const sum = (type: string) => rows.filter((r) => r.itemType === type).reduce((s, r) => s.plus(r.remainingAmount.toString()), new Decimal(0));
    const receivable = sum('RECEIVABLE');
    const payable = sum('PAYABLE');
    const customerAdvance = sum('CUSTOMER_ADVANCE').abs();
    const supplierAdvance = sum('SUPPLIER_ADVANCE').abs();
    return {
      counterpartyId,
      receivable: receivable.toFixed(2),
      payable: payable.toFixed(2),
      customerAdvance: customerAdvance.toFixed(2),
      supplierAdvance: supplierAdvance.toFixed(2),
      netPosition: receivable.minus(payable).minus(customerAdvance).plus(supplierAdvance).toFixed(2),
    };
  }

  /** `getOpenForeignCurrencyItems(asOfDate)` (spec section 57, 92) — the
   * stable interface Phase 22's unrealized FX revaluation will call. */
  async getOpenForeignCurrencyItems(tenantId: string, organizationId: string, baseCurrencyId: string, asOfDate: Date): Promise<OpenItemView[]> {
    const rows = await this.prisma.settlementOpenItem.findMany({
      where: { tenantId, organizationId, currencyId: { not: baseCurrencyId }, status: { notIn: ['SETTLED', 'CANCELLED', 'WRITTEN_OFF'] }, sourceDate: { lte: asOfDate } },
    });
    return rows.map(toView).filter((r) => new Decimal(r.remainingAmount).abs().gt(EPSILON));
  }
}

export function toView(row: {
  id: string;
  counterpartyId: string;
  itemType: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber: string | null;
  sourceDate: Date;
  dueDate: Date | null;
  currencyId: string | null;
  originalAmount: any;
  remainingAmount: any;
  status: string;
  disputedAmount: any;
  blockedForPayment: boolean;
}): OpenItemView {
  const remaining = new Decimal(row.remainingAmount.toString());
  const isAdvance = row.itemType === 'CUSTOMER_ADVANCE' || row.itemType === 'SUPPLIER_ADVANCE';
  const overdueDays = !isAdvance && row.dueDate && remaining.gt(EPSILON) && row.dueDate < new Date() ? Math.floor((Date.now() - row.dueDate.getTime()) / 86_400_000) : 0;
  const isOverdue = !['DISPUTED', 'ON_HOLD', 'WRITTEN_OFF', 'CANCELLED', 'SETTLED'].includes(row.status) && overdueDays > 0;
  return {
    id: row.id,
    counterpartyId: row.counterpartyId,
    itemType: row.itemType,
    sourceDocumentType: row.sourceDocumentType,
    sourceDocumentId: row.sourceDocumentId,
    sourceDocumentNumber: row.sourceDocumentNumber,
    sourceDate: row.sourceDate.toISOString().slice(0, 10),
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    currencyId: row.currencyId,
    originalAmount: row.originalAmount.toString(),
    remainingAmount: remaining.toFixed(2),
    status: isOverdue ? 'OVERDUE' : row.status,
    overdueDays,
    disputedAmount: row.disputedAmount.toString(),
    blockedForPayment: row.blockedForPayment,
  };
}
