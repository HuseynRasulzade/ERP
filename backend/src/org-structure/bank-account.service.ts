import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface BankAccountInput {
  bankName: string;
  bankCode?: string;
  branchName?: string;
  accountName: string;
  iban: string;
  swiftBic?: string;
  currencyId: string;
  correspondentAccount?: string;
  accountType?: string;
  isDefault?: boolean;
  openedDate?: Date;
}

/**
 * Organization bank account MASTER DATA ONLY (section 14/15) — statements/
 * payments/reconciliation belong to Phase 14. "At most one default active
 * account per organization" is enforced both by a DB partial unique index
 * (`bank_accounts_one_default_per_org`) and by clearing any prior default
 * inside the same transaction (section 41) — belt and suspenders.
 */
@Injectable()
export class BankAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.bankAccount.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { accountName: 'asc' },
    });
  }

  private assertIban(iban: string, countryCode = 'AZ') {
    // Modular, country-aware validation (section 14): AZ IBANs are 28 chars
    // (AZ + 2 check digits + 4 bank code + 20 alphanumeric); other
    // countries are only checked for the generic ISO 13616 shape so the
    // platform never hard-assumes every tenant is Azerbaijani.
    const compact = iban.replace(/\s+/g, '').toUpperCase();
    if (countryCode === 'AZ' && !/^AZ\d{2}[A-Z0-9]{4}[A-Z0-9]{20}$/.test(compact)) {
      throw new ValidationAppError('Invalid AZ IBAN format');
    }
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
      throw new ValidationAppError('Invalid IBAN format');
    }
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: BankAccountInput) {
    const org = await this.access.assertAccess(tenantId, membershipId, organizationId);
    this.assertIban(input.iban, org.countryCode);

    const currency = await this.prisma.currency.findUnique({ where: { id: input.currencyId } });
    if (!currency) throw new ValidationAppError('Unknown currency');

    return this.prisma.runInTransaction(async (tx) => {
      if (input.isDefault) {
        await tx.bankAccount.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const account = await tx.bankAccount.create({
        data: { tenantId, organizationId, createdBy: userId, updatedBy: userId, ...input },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'BANK_ACCOUNT_CREATED',
          entityType: 'BankAccount',
          entityId: account.id,
          action: 'CREATE',
          userId,
          newValues: { accountName: account.accountName, iban: account.iban },
        },
        tx,
      );

      return account;
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const account = await this.prisma.bankAccount.findFirst({ where: { id, organizationId } });
    if (!account) throw new NotFoundAppError('BankAccount', id);
    return account;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<BankAccountInput>,
  ) {
    const org = await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.iban) this.assertIban(patch.iban, org.countryCode);

    return this.prisma.runInTransaction(async (tx) => {
      if (patch.isDefault) {
        await tx.bankAccount.updateMany({
          where: { organizationId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      const result = await tx.bankAccount.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: { ...patch, updatedBy: userId, version: { increment: 1 } },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'BANK_ACCOUNT_UPDATED',
          entityType: 'BankAccount',
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: patch,
        },
        tx,
      );

      return tx.bankAccount.findUnique({ where: { id } });
    });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const account = await this.get(tenantId, membershipId, organizationId, id);
    if (!account.active) throw new ValidationAppError('Bank account is already inactive');

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.bankAccount.updateMany({
        where: { id, organizationId, version: expectedVersion },
        // Never hard-delete a bank account (section 15); closing sets
        // active=false + closedDate, and it can no longer be "the" default.
        data: { active: false, isDefault: false, closedDate: new Date(), updatedBy: userId, version: { increment: 1 } },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await tx.organization.updateMany({
        where: { id: organizationId, defaultBankAccountId: id },
        data: { defaultBankAccountId: null },
      });
    });

    await this.audit.record({
      tenantId,
      eventType: 'BANK_ACCOUNT_DEACTIVATED',
      entityType: 'BankAccount',
      entityId: id,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.bankAccount.findUnique({ where: { id } });
  }
}
