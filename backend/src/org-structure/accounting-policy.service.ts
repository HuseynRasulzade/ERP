import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import { rangesOverlap } from './effective-date.util';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const VALID_COSTING_METHODS = ['FIFO', 'WEIGHTED_AVERAGE'];

export interface AccountingPolicyInput {
  code: string;
  name: string;
  validFrom: Date;
  validTo?: Date | null;
  inventoryCostingMethod?: string;
  baseCurrencyId?: string;
  taxProfileId?: string;
  settings?: Record<string, unknown>;
}

/**
 * Accounting Policy METADATA + effective dating ONLY (section 16-18, 39).
 * The costing engine itself is Phase 11 — this only stores the choice and
 * guarantees `resolve()` can find the version valid on any business date.
 *
 * Immutability-after-use (section 39): Phase 1 has no posted-transaction
 * tracking yet, so `assertMutable` is a no-op today, but every mutating
 * method routes through it — Phase 4 wires real usage-checking in here
 * without any caller needing to change.
 */
@Injectable()
export class AccountingPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** Extension point for Phase 4: reject edits to a policy once posted
   * transactions have used it. Currently always allows — Phase 1 does not
   * yet have anything that could have used one. */
  private async assertMutable(_policyId: string): Promise<void> {
    // No-op placeholder — see class doc.
  }

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.accountingPolicy.findMany({ where: { organizationId }, orderBy: { validFrom: 'desc' } });
  }

  private async assertNoOverlap(organizationId: string, validFrom: Date, validTo: Date | null | undefined, excludeId?: string) {
    const others = await this.prisma.accountingPolicy.findMany({
      where: { organizationId, active: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    for (const other of others) {
      if (rangesOverlap(validFrom, validTo ?? null, other.validFrom, other.validTo)) {
        throw new ConflictAppError(
          `Effective period overlaps existing policy "${other.code}" (${other.validFrom.toISOString().slice(0, 10)} - ${
            other.validTo ? other.validTo.toISOString().slice(0, 10) : 'open'
          })`,
        );
      }
    }
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: AccountingPolicyInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    if (input.inventoryCostingMethod && !VALID_COSTING_METHODS.includes(input.inventoryCostingMethod)) {
      throw new ValidationAppError(`Unknown inventory costing method: ${input.inventoryCostingMethod}`);
    }
    await this.assertNoOverlap(organizationId, input.validFrom, input.validTo);

    const existingCode = await this.prisma.accountingPolicy.findUnique({
      where: { organizationId_code_validFrom: { organizationId, code: input.code, validFrom: input.validFrom } },
    });
    if (existingCode) throw new ConflictAppError('An accounting policy with this code and effective date already exists');

    const policy = await this.prisma.accountingPolicy.create({
      data: { tenantId, organizationId, createdBy: userId, updatedBy: userId, settings: input.settings as any, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'ACCOUNTING_POLICY_CREATED',
      entityType: 'AccountingPolicy',
      entityId: policy.id,
      action: 'CREATE',
      userId,
      newValues: { code: policy.code, validFrom: policy.validFrom },
    });

    return policy;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const policy = await this.prisma.accountingPolicy.findFirst({ where: { id, organizationId } });
    if (!policy) throw new NotFoundAppError('AccountingPolicy', id);
    return policy;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<AccountingPolicyInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertMutable(id);

    if (patch.inventoryCostingMethod && !VALID_COSTING_METHODS.includes(patch.inventoryCostingMethod)) {
      throw new ValidationAppError(`Unknown inventory costing method: ${patch.inventoryCostingMethod}`);
    }
    if (patch.validFrom || patch.validTo !== undefined) {
      const current = await this.get(tenantId, membershipId, organizationId, id);
      await this.assertNoOverlap(organizationId, patch.validFrom ?? current.validFrom, patch.validTo ?? current.validTo, id);
    }

    const result = await this.prisma.accountingPolicy.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { ...patch, settings: patch.settings as any, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'ACCOUNTING_POLICY_CHANGED',
      entityType: 'AccountingPolicy',
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.accountingPolicy.findUnique({ where: { id } });
  }

  /**
   * `getAccountingPolicy(organization, businessDate)` (section 17/29):
   * one match -> return it; none -> explicit config error; more than one
   * (should be structurally impossible given `assertNoOverlap`) -> data
   * integrity error rather than silently picking one.
   */
  async resolve(tenantId: string, organizationId: string, businessDate: Date) {
    await this.prisma.organization.findFirst({ where: { id: organizationId, tenantId } }).then((org) => {
      if (!org) throw new NotFoundAppError('Organization', organizationId);
    });

    const matches = await this.prisma.accountingPolicy.findMany({
      where: {
        organizationId,
        active: true,
        validFrom: { lte: businessDate },
        OR: [{ validTo: null }, { validTo: { gte: businessDate } }],
      },
    });

    if (matches.length === 0) {
      throw new ValidationAppError(`No accounting policy is configured for ${businessDate.toISOString().slice(0, 10)}`);
    }
    if (matches.length > 1) {
      throw new ConflictAppError('Multiple overlapping accounting policies matched — data integrity error');
    }
    return matches[0];
  }
}
