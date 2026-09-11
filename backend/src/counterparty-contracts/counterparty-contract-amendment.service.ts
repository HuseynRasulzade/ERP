import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CounterpartyContractService, STATUSES } from './counterparty-contract.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * CounterpartyContractAmendment service ("Əlavə", spec section 6). Always
 * belongs to exactly one parent contract; number is unique WITHIN that
 * contract (not globally, unlike the contract's own number which is
 * unique within its counterparty).
 */
@Injectable()
export class CounterpartyContractAmendmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly contracts: CounterpartyContractService,
  ) {}

  async listForContract(tenantId: string, membershipId: string, organizationId: string, contractId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.contracts.get(tenantId, membershipId, organizationId, contractId);
    return this.prisma.counterpartyContractAmendment.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const amendment = await this.prisma.counterpartyContractAmendment.findFirst({
      where: { id, tenantId, contract: { organizationId } },
    });
    if (!amendment) throw new NotFoundAppError('CounterpartyContractAmendment', id);
    return amendment;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, contractId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.contracts.get(tenantId, membershipId, organizationId, contractId);

    const existing = await this.prisma.counterpartyContractAmendment.findUnique({
      where: { contractId_number: { contractId, number: input.number } },
    });
    if (existing) throw new ConflictAppError(`An amendment with number ${input.number} already exists for this contract`);

    if (input.currencyId) {
      const cur = await this.prisma.currency.findUnique({ where: { id: input.currencyId } });
      if (!cur) throw new ValidationAppError('Currency not found');
    }

    const amendment = await this.prisma.counterpartyContractAmendment.create({
      data: {
        tenantId, contractId, createdBy: userId, updatedBy: userId,
        number: input.number, subject: input.subject,
        amendmentDate: input.amendmentDate ? new Date(input.amendmentDate) : undefined,
        effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        newAmount: input.newAmount != null ? new Decimal(input.newAmount.toString()) : undefined,
        currencyId: input.currencyId, changeDescription: input.changeDescription, notes: input.notes,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'CONTRACT_AMENDMENT_CREATED', entityType: 'CounterpartyContractAmendment',
      entityId: amendment.id, action: 'CREATE', userId, newValues: { number: amendment.number, contractId },
    });
    return amendment;
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);

    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    for (const k of Object.keys(patch)) {
      if (['amendmentDate', 'effectiveDate', 'endDate'].includes(k) && patch[k] !== undefined) updateData[k] = new Date(patch[k]);
      else if (k === 'newAmount' && patch.newAmount !== undefined && patch.newAmount !== null) updateData.newAmount = new Decimal(patch.newAmount.toString());
      else if (patch[k] !== undefined) updateData[k] = patch[k];
    }
    const result = await this.prisma.counterpartyContractAmendment.updateMany({ where: { id, tenantId, version: expectedVersion }, data: updateData });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'CONTRACT_AMENDMENT_UPDATED', entityType: 'CounterpartyContractAmendment', entityId: id, action: 'UPDATE', userId, newValues: patch });
    return this.prisma.counterpartyContractAmendment.findUnique({ where: { id } });
  }

  /** Approval gate (spec sections 6, 8): number/subject/dates/change
   * description are always mandatory; `newAmount`+`currencyId` are only
   * required together when a change description mentions an amount
   * change is genuinely conditional per the spec ("əgər məbləğ
   * dəyişikliyi varsa") — this build cannot infer that from free text, so
   * amount/currency are validated as a PAIR (both set or both empty)
   * rather than unconditionally required (disclosed simplification, see
   * docs/COUNTERPARTY_MANAGEMENT.md). */
  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const amendment = await this.get(tenantId, membershipId, organizationId, id);
    if (amendment.status === 'APPROVED' || amendment.status === 'ACTIVE') throw new ValidationAppError(`Amendment is already ${amendment.status}`);
    if (amendment.status === 'CANCELLED') throw new ValidationAppError('Cannot approve a cancelled amendment');

    const missing = this.missingRequiredFields(amendment);
    if (missing.length > 0) {
      const fieldErrors: Record<string, string[]> = {};
      for (const f of missing) fieldErrors[f] = ['Required for approval'];
      throw new ValidationAppError(`Cannot approve — missing required fields: ${missing.join(', ')}`, fieldErrors);
    }

    const result = await this.prisma.counterpartyContractAmendment.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'CONTRACT_AMENDMENT_APPROVED', entityType: 'CounterpartyContractAmendment', entityId: id, action: 'APPROVE', userId });
    return this.prisma.counterpartyContractAmendment.findUnique({ where: { id } });
  }

  async setStatus(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, status: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!STATUSES.includes(status)) throw new ValidationAppError(`Unknown status: ${status}`);
    const amendment = await this.get(tenantId, membershipId, organizationId, id);
    if (status !== 'CANCELLED' && (amendment.status === 'DRAFT' || amendment.status === 'PENDING_APPROVAL')) {
      throw new ValidationAppError('Approve the amendment before changing its status further');
    }
    const result = await this.prisma.counterpartyContractAmendment.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { status, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'CONTRACT_AMENDMENT_STATUS_CHANGED', entityType: 'CounterpartyContractAmendment', entityId: id, action: 'UPDATE', userId, newValues: { status } });
    return this.prisma.counterpartyContractAmendment.findUnique({ where: { id } });
  }

  private missingRequiredFields(amendment: any): string[] {
    const missing: string[] = [];
    if (!amendment.number?.trim()) missing.push('number');
    if (!amendment.subject?.trim()) missing.push('subject');
    if (!amendment.amendmentDate) missing.push('amendmentDate');
    if (!amendment.effectiveDate) missing.push('effectiveDate');
    if (!amendment.endDate) missing.push('endDate');
    if (!amendment.changeDescription?.trim()) missing.push('changeDescription');
    const hasAmount = amendment.newAmount != null;
    const hasCurrency = !!amendment.currencyId;
    if (hasAmount !== hasCurrency) missing.push(hasAmount ? 'currencyId' : 'newAmount');
    return missing;
  }
}
