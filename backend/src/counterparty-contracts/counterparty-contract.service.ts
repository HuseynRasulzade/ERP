import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CounterpartyService } from '../counterparty-pricing/counterparty.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRED', 'CANCELLED'];

/**
 * CounterpartyContract service ("Kontragentlər" module, spec section 5).
 * Plain CRUD + a bespoke approval gate, same non-posting shape as
 * PurchaseRequirement/CounterpartyService — a contract never touches GL
 * or inventory.
 */
@Injectable()
export class CounterpartyContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly counterparties: CounterpartyService,
  ) {}

  async listForCounterparty(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.counterparties.get(tenantId, membershipId, organizationId, counterpartyId);
    return this.prisma.counterpartyContract.findMany({ where: { counterpartyId, organizationId }, orderBy: { createdAt: 'desc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.prisma.counterpartyContract.findFirst({
      where: { id, organizationId },
      include: { amendments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!contract) throw new NotFoundAppError('CounterpartyContract', id);
    return contract;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.counterparties.get(tenantId, membershipId, organizationId, counterpartyId);

    const existing = await this.prisma.counterpartyContract.findUnique({
      where: { counterpartyId_number: { counterpartyId, number: input.number } },
    });
    if (existing) throw new ConflictAppError(`A contract with number ${input.number} already exists for this counterparty`);

    if (input.currencyId) await this.assertCurrency(input.currencyId);
    if (input.responsiblePersonId) await this.assertResponsiblePerson(tenantId, input.responsiblePersonId);

    const contract = await this.prisma.counterpartyContract.create({
      data: {
        tenantId, organizationId, counterpartyId, createdBy: userId, updatedBy: userId,
        number: input.number, subject: input.subject, contractType: input.contractType,
        signedDate: input.signedDate ? new Date(input.signedDate) : undefined,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        amount: input.amount != null ? new Decimal(input.amount.toString()) : undefined,
        currencyId: input.currencyId, paymentTerms: input.paymentTerms,
        responsiblePersonId: input.responsiblePersonId, notes: input.notes,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_CREATED', entityType: 'CounterpartyContract',
      entityId: contract.id, action: 'CREATE', userId, newValues: { number: contract.number, counterpartyId },
    });
    return contract;
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.currencyId) await this.assertCurrency(patch.currencyId);
    if (patch.responsiblePersonId) await this.assertResponsiblePerson(tenantId, patch.responsiblePersonId);

    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    for (const k of Object.keys(patch)) {
      if (['signedDate', 'startDate', 'endDate'].includes(k) && patch[k] !== undefined) updateData[k] = new Date(patch[k]);
      else if (k === 'amount' && patch.amount !== undefined && patch.amount !== null) updateData.amount = new Decimal(patch.amount.toString());
      else if (patch[k] !== undefined) updateData[k] = patch[k];
    }
    const result = await this.prisma.counterpartyContract.updateMany({ where: { id, organizationId, version: expectedVersion }, data: updateData });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTRACT_UPDATED', entityType: 'CounterpartyContract',
      entityId: id, action: 'UPDATE', userId, newValues: patch,
    });
    return this.prisma.counterpartyContract.findUnique({ where: { id } });
  }

  /** Approval gate (spec sections 5, 8) — every field the spec's own list
   * for section 5 names is mandatory before a contract can leave DRAFT.
   * Missing fields are collected together, never fail-fast. */
  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.get(tenantId, membershipId, organizationId, id);
    if (contract.status === 'APPROVED' || contract.status === 'ACTIVE') throw new ValidationAppError(`Contract is already ${contract.status}`);
    if (contract.status === 'CANCELLED') throw new ValidationAppError('Cannot approve a cancelled contract');

    const missing = this.missingRequiredFields(contract);
    if (missing.length > 0) {
      const fieldErrors: Record<string, string[]> = {};
      for (const f of missing) fieldErrors[f] = ['Required for approval'];
      throw new ValidationAppError(`Cannot approve — missing required fields: ${missing.join(', ')}`, fieldErrors);
    }

    const result = await this.prisma.counterpartyContract.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'COUNTERPARTY_CONTRACT_APPROVED', entityType: 'CounterpartyContract', entityId: id, action: 'APPROVE', userId });
    return this.prisma.counterpartyContract.findUnique({ where: { id } });
  }

  async setStatus(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, status: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!STATUSES.includes(status)) throw new ValidationAppError(`Unknown status: ${status}`);
    const contract = await this.get(tenantId, membershipId, organizationId, id);
    if (status !== 'CANCELLED' && (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL')) {
      throw new ValidationAppError('Approve the contract before changing its status further');
    }
    const result = await this.prisma.counterpartyContract.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { status, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'COUNTERPARTY_CONTRACT_STATUS_CHANGED', entityType: 'CounterpartyContract', entityId: id, action: 'UPDATE', userId, newValues: { status } });
    return this.prisma.counterpartyContract.findUnique({ where: { id } });
  }

  // -- helpers ----------------------------------------------------------------

  private async assertCurrency(currencyId: string) {
    const cur = await this.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!cur) throw new ValidationAppError('Currency not found');
  }

  private async assertResponsiblePerson(tenantId: string, id: string) {
    const person = await this.prisma.responsiblePerson.findFirst({ where: { id, tenantId } });
    if (!person) throw new ValidationAppError('Responsible person not found');
  }

  private missingRequiredFields(contract: any): string[] {
    const missing: string[] = [];
    if (!contract.number?.trim()) missing.push('number');
    if (!contract.subject?.trim()) missing.push('subject');
    if (!contract.contractType?.trim()) missing.push('contractType');
    if (!contract.signedDate) missing.push('signedDate');
    if (!contract.startDate) missing.push('startDate');
    if (!contract.endDate) missing.push('endDate');
    if (contract.amount == null) missing.push('amount');
    if (!contract.currencyId) missing.push('currencyId');
    if (!contract.paymentTerms?.trim()) missing.push('paymentTerms');
    if (!contract.responsiblePersonId) missing.push('responsiblePersonId');
    return missing;
  }
}
