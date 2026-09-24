import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface BankInput {
  code: string;
  name: string;
  swiftBic?: string;
  correspondentAccount?: string;
  address?: string;
}

/**
 * Bank (institution) catalog — 1C's "Банки" directory, tenant-wide and
 * separate from BankAccount (an organization's account AT a bank).
 * Mirrors UnitOfMeasureService's tenant-scoped catalog pattern exactly.
 */
@Injectable()
export class BankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, includeInactive = false) {
    return this.prisma.bank.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, userId: string, input: BankInput) {
    const existing = await this.prisma.bank.findUnique({
      where: { tenantId_code: { tenantId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Bank code already exists: ${input.code}`);

    const bank = await this.prisma.bank.create({
      data: { tenantId, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'BANK_CREATED',
      entityType: 'Bank',
      entityId: bank.id,
      action: 'CREATE',
      userId,
      newValues: { code: bank.code, name: bank.name },
    });

    return bank;
  }

  async get(tenantId: string, bankId: string) {
    const bank = await this.prisma.bank.findFirst({ where: { id: bankId, tenantId } });
    if (!bank) throw new NotFoundAppError('Bank', bankId);
    return bank;
  }

  async update(tenantId: string, bankId: string, userId: string, expectedVersion: number, patch: Partial<Omit<BankInput, 'code'>>) {
    const result = await this.prisma.bank.updateMany({
      where: { id: bankId, tenantId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'BANK_UPDATED',
      entityType: 'Bank',
      entityId: bankId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.bank.findUnique({ where: { id: bankId } });
  }

  async deactivate(tenantId: string, bankId: string, userId: string, expectedVersion: number) {
    const bank = await this.get(tenantId, bankId);
    if (!bank.active) throw new ValidationAppError('Bank is already inactive');

    const accountsUsingBank = await this.prisma.bankAccount.count({ where: { tenantId, bankId, active: true } });
    if (accountsUsingBank > 0) {
      throw new ValidationAppError(`Cannot deactivate bank: ${accountsUsingBank} active bank account(s) reference it`);
    }

    const result = await this.prisma.bank.updateMany({
      where: { id: bankId, tenantId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'BANK_DEACTIVATED',
      entityType: 'Bank',
      entityId: bankId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.bank.findUnique({ where: { id: bankId } });
  }
}
