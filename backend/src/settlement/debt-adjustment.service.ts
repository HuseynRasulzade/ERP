import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { DEBT_ADJUSTMENT_TYPE } from './debt-adjustment.repository';

const SEQUENCE_PREFIX = 'DADJ';

/** DebtAdjustmentService — manual settlement corrections (spec section
 * 95) always require an explicit `reasonCode`; permission gating
 * (`SETTLEMENT_CREATE_ADJUSTMENT`) happens at the controller. */
@Injectable()
export class DebtAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.debtAdjustment.findMany({ where: { organizationId, counterpartyId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.debtAdjustment.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('DebtAdjustment', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { counterpartyId: string; counterpartyRole: string; contractId?: string; operationType: string; reasonCode: string; targetOpenItemType?: string; targetOpenItemId?: string; targetContractId?: string; currencyId: string; amount: number; documentDate: string; description?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!dto.reasonCode) throw new ValidationAppError('A reason code is required for a manual debt adjustment (spec section 95)');
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, DEBT_ADJUSTMENT_TYPE, documentDate, tx);
      const row = await tx.debtAdjustment.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: dto.counterpartyId,
          counterpartyRole: dto.counterpartyRole,
          contractId: dto.contractId,
          operationType: dto.operationType,
          reasonCode: dto.reasonCode,
          targetOpenItemType: dto.targetOpenItemType,
          targetOpenItemId: dto.targetOpenItemId,
          targetContractId: dto.targetContractId,
          currencyId: dto.currencyId,
          amount: dto.amount.toString(),
          number: allocated.formatted,
          documentDate,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'DEBT_ADJUSTED', entityType: DEBT_ADJUSTMENT_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { operationType: dto.operationType, amount: dto.amount, reasonCode: dto.reasonCode } }, tx);
      return row;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: DEBT_ADJUSTMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: DEBT_ADJUSTMENT_TYPE, documentType: DEBT_ADJUSTMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
