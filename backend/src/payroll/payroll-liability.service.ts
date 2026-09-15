import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * PayrollLiabilityService (spec sections 99-109). Payroll calculated
 * being posted is NOT the same as paid (spec section 124) — this service
 * only records that an ACTUAL payment (a Phase 13/14/15 `SettlementPayment`
 * — never a duplicate bank/cash engine, spec sections 105-107) has been
 * allocated against one or more liabilities; it never moves money itself.
 */
@Injectable()
export class PayrollLiabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, employmentId?: string, liabilityType?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.payrollLiability.findMany({ where: { tenantId, organizationId, employmentId, liabilityType, status: { not: 'PAID' } }, orderBy: { dueDate: 'asc' } }));
  }

  /** Records that `paymentDocumentId` (e.g. a posted SettlementPayment)
   * paid `amount` toward this liability — supports partial payments
   * (spec section 108) and multiple payments (spec section 109, e.g. an
   * advance plus a final payment). */
  async allocate(tenantId: string, membershipId: string, organizationId: string, userId: string, liabilityId: string, dto: { paymentDocumentType: string; paymentDocumentId: string; amount: number; allocationDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const liability = await this.prisma.payrollLiability.findFirst({ where: { id: liabilityId, tenantId, organizationId } });
    if (!liability) throw new NotFoundAppError('PayrollLiability', liabilityId);
    const amount = new Decimal(dto.amount);
    if (amount.lte(0)) throw new ValidationAppError('Allocation amount must be positive');
    if (amount.gt(new Decimal(liability.outstanding.toString()).plus('0.01'))) throw new ValidationAppError(`Allocation of ${amount.toString()} exceeds the outstanding balance of ${liability.outstanding.toString()}.`);

    return this.prisma.runInTransaction(async (tx) => {
      const allocation = await tx.payrollPaymentAllocation.create({ data: { tenantId, liabilityId, paymentDocumentType: dto.paymentDocumentType, paymentDocumentId: dto.paymentDocumentId, amount: amount.toString(), allocationDate: new Date(dto.allocationDate), createdBy: userId } });
      const newPaid = new Decimal(liability.paid.toString()).plus(amount);
      const newOutstanding = new Decimal(liability.outstanding.toString()).minus(amount);
      const status = newOutstanding.lte('0.01') ? 'PAID' : 'PARTIALLY_PAID';
      const updated = await tx.payrollLiability.update({ where: { id: liabilityId }, data: { paid: newPaid.toString(), outstanding: newOutstanding.toString(), status } });
      await this.audit.record({ tenantId, eventType: 'PAYROLL_LIABILITY_PAYMENT_ALLOCATED', entityType: 'PAYROLL_LIABILITY', entityId: liabilityId, action: 'UPDATE', userId, newValues: { amount: dto.amount, paymentDocumentType: dto.paymentDocumentType, paymentDocumentId: dto.paymentDocumentId, newStatus: status } }, tx);
      return { allocation, liability: updated };
    });
  }

  async reverseAllocation(tenantId: string, membershipId: string, organizationId: string, userId: string, allocationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const allocation = await this.prisma.payrollPaymentAllocation.findFirst({ where: { id: allocationId, tenantId, status: 'ACTIVE' }, include: { liability: true } });
    if (!allocation) throw new NotFoundAppError('PayrollPaymentAllocation', allocationId);
    return this.prisma.runInTransaction(async (tx) => {
      await tx.payrollPaymentAllocation.update({ where: { id: allocationId }, data: { status: 'REVERSED' } });
      const newPaid = new Decimal(allocation.liability.paid.toString()).minus(allocation.amount.toString());
      const newOutstanding = new Decimal(allocation.liability.outstanding.toString()).plus(allocation.amount.toString());
      const status = newPaid.lte('0.01') ? 'OPEN' : 'PARTIALLY_PAID';
      const updated = await tx.payrollLiability.update({ where: { id: allocation.liabilityId }, data: { paid: newPaid.toString(), outstanding: newOutstanding.toString(), status } });
      await this.audit.record({ tenantId, eventType: 'PAYROLL_LIABILITY_PAYMENT_REVERSED', entityType: 'PAYROLL_LIABILITY', entityId: allocation.liabilityId, action: 'UPDATE', userId, newValues: { amount: allocation.amount.toString() } }, tx);
      return updated;
    });
  }

  /** Employee payslip data (spec sections 72-73) — assembled directly
   * from the subledger, never from the GL. */
  async payslip(tenantId: string, membershipId: string, organizationId: string, employmentId: string, payrollPeriodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const result = await this.prisma.payrollCalculationResult.findFirst({ where: { tenantId, organizationId, employmentId, payrollPeriodId, status: { not: 'SUPERSEDED' } }, include: { lines: true, employment: { include: { employee: { include: { physicalPerson: true } } } }, period: true } });
    if (!result) throw new NotFoundAppError('PayrollCalculationResult', `${employmentId}/${payrollPeriodId}`);
    const liabilities = await this.prisma.payrollLiability.findMany({ where: { tenantId, employmentId, payrollPeriodId } });
    const netPayLiability = liabilities.find((l) => l.liabilityType === 'EMPLOYEE_NET_PAY');
    return {
      employee: result.employment.employee.physicalPerson.fullName,
      period: `${result.period.year}-${String(result.period.month).padStart(2, '0')}`,
      earnings: result.lines.filter((l) => l.lineType === 'EARNING'),
      deductions: result.lines.filter((l) => l.lineType === 'DEDUCTION'),
      employerContributions: result.lines.filter((l) => l.lineType === 'EMPLOYER_CONTRIBUTION'),
      gross: result.gross.toString(),
      taxableBase: result.taxableIncome.toString(),
      net: result.net.toString(),
      currentPaymentDue: netPayLiability?.outstanding.toString() ?? '0',
      outstandingPayrollDebt: liabilities.filter((l) => l.status !== 'PAID').reduce((s, l) => s.plus(l.outstanding.toString()), new Decimal(0)).toString(),
    };
  }
}
