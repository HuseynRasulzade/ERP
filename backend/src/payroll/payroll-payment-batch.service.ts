import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreatePaymentBatchDto, RecordPaymentDto } from './dto/payroll.dto';
import { LiabilityCategories, PayrollLiabilityService } from './payroll-liability.service';

const BATCH_ENTITY_TYPE = 'PAYROLL_PAYMENT_BATCH';
const ALLOCATION_ENTITY_TYPE = 'PAYROLL_PAYMENT_ALLOCATION';
const PAYABLE_STATUSES = ['POSTED', 'PARTIALLY_PAID'];

/**
 * PayrollPaymentBatchService — the stable contract Phase 14 (bank)/
 * Phase 15 (cash) consume (docx spec Phase 19 sections 104-111): this
 * module determines who is owed what (via the PAYROLL_LIABILITY_REGISTER)
 * and records that it was paid; it never executes the actual money
 * movement itself. Disclosed simplification: a batch confirms
 * immediately at creation (pays each listed employment's FULL
 * outstanding net-pay liability) rather than a separate draft/confirm
 * workflow — Phase 14/15 do not exist yet in this build to be the real
 * trigger for a later "confirm" step. `recordPayment` below is the
 * companion path for a single, possibly PARTIAL, off-batch payment.
 */
@Injectable()
export class PayrollPaymentBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly liability: PayrollLiabilityService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, periodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.payrollPaymentBatch.findMany({
      where: { tenantId, organizationId, payrollPeriodId: periodId },
      orderBy: { createdAt: 'desc' },
      include: { allocations: true },
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.payrollPaymentBatch.findFirst({
      where: { id, tenantId, organizationId },
      include: { allocations: true },
    });
    if (!row) throw new NotFoundAppError('PayrollPaymentBatch', id);
    return row;
  }

  async createAndConfirm(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    periodId: string,
    dto: CreatePaymentBatchDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', periodId);
    if (!PAYABLE_STATUSES.includes(period.status))
      throw new ValidationAppError(
        `Cannot pay a payroll period in status ${period.status} — it must be posted to the GL first`,
      );
    if (dto.paymentMethod === 'BANK' && !dto.bankAccountId)
      throw new ValidationAppError('A BANK payment batch requires a bankAccountId');
    if (dto.paymentMethod === 'CASH' && !dto.cashDeskId)
      throw new ValidationAppError('A CASH payment batch requires a cashDeskId');
    if (dto.employmentIds.length === 0) throw new ValidationAppError('employmentIds must not be empty');

    const paymentDate = new Date(dto.paymentDate);
    const created = await this.prisma.runInTransaction(async (tx) => {
      const batch = await tx.payrollPaymentBatch.create({
        data: {
          tenantId,
          organizationId,
          payrollPeriodId: periodId,
          paymentMethod: dto.paymentMethod,
          bankAccountId: dto.bankAccountId,
          cashDeskId: dto.cashDeskId,
          paymentDate,
          createdBy: userId,
        },
      });

      let total = new Decimal(0);
      for (const employmentId of dto.employmentIds) {
        const outstanding = await this.liability.getOutstandingBalance(tenantId, employmentId, LiabilityCategories.NET_PAY, tx);
        if (outstanding.lte(0)) continue;
        const allocation = await tx.payrollPaymentAllocation.create({
          data: {
            tenantId,
            paymentBatchId: batch.id,
            employmentId,
            payrollPeriodId: periodId,
            amount: outstanding,
            allocationDate: paymentDate,
            status: 'PAID',
          },
        });
        await this.liability.recordDecrease(tenantId, tx, {
          allocationId: allocation.id,
          employmentId,
          organizationId,
          payrollPeriodId: periodId,
          category: LiabilityCategories.NET_PAY,
          amount: outstanding,
          businessDate: paymentDate,
        });
        total = total.plus(outstanding);
      }

      const updated = await tx.payrollPaymentBatch.update({
        where: { id: batch.id },
        data: { totalAmount: total, status: 'CONFIRMED' },
        include: { allocations: true },
      });
      await this.recomputePeriodPaymentStatus(tenantId, periodId, tx);
      return updated;
    });

    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_PAYMENT_BATCH_CONFIRMED',
      entityType: BATCH_ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { totalAmount: created.totalAmount.toString(), allocationCount: created.allocations.length },
    });
    return created;
  }

  async recordPayment(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    periodId: string,
    dto: RecordPaymentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', periodId);
    if (!PAYABLE_STATUSES.includes(period.status))
      throw new ValidationAppError(
        `Cannot pay a payroll period in status ${period.status} — it must be posted to the GL first`,
      );

    const outstanding = await this.liability.getOutstandingBalance(tenantId, dto.employmentId, LiabilityCategories.NET_PAY);
    const amount = new Decimal(dto.amount);
    if (amount.gt(outstanding))
      throw new ValidationAppError(
        `Payment amount ${amount.toFixed(2)} exceeds the outstanding net pay liability ${outstanding.toFixed(2)}`,
      );

    const created = await this.prisma.runInTransaction(async (tx) => {
      const allocation = await tx.payrollPaymentAllocation.create({
        data: {
          tenantId,
          employmentId: dto.employmentId,
          payrollPeriodId: periodId,
          amount,
          allocationDate: new Date(dto.allocationDate),
          paymentDocumentType: dto.paymentDocumentType,
          paymentDocumentId: dto.paymentDocumentId,
          status: 'PAID',
        },
      });
      await this.liability.recordDecrease(tenantId, tx, {
        allocationId: allocation.id,
        employmentId: dto.employmentId,
        organizationId,
        payrollPeriodId: periodId,
        category: LiabilityCategories.NET_PAY,
        amount,
        businessDate: new Date(dto.allocationDate),
      });
      await this.recomputePeriodPaymentStatus(tenantId, periodId, tx);
      return allocation;
    });

    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_PAYMENT_RECORDED',
      entityType: ALLOCATION_ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { employmentId: dto.employmentId, amount: amount.toFixed(2) },
    });
    return created;
  }

  private async recomputePeriodPaymentStatus(tenantId: string, periodId: string, tx: PrismaTransactionClient) {
    const results = await tx.payrollCalculationResult.findMany({
      where: { tenantId, payrollPeriodId: periodId, status: 'CALCULATED' },
    });
    const totalNet = results.reduce((sum, r) => sum.plus(r.net.toString()), new Decimal(0));

    const paidAgg = await tx.payrollPaymentAllocation.aggregate({
      where: { tenantId, payrollPeriodId: periodId, status: 'PAID' },
      _sum: { amount: true },
    });
    const paidTotal = new Decimal(paidAgg._sum.amount?.toString() ?? '0');

    const status = totalNet.gt(0) && paidTotal.gte(totalNet) ? 'PAID' : 'PARTIALLY_PAID';
    await tx.payrollPeriod.updateMany({ where: { id: periodId, tenantId }, data: { status } });
  }
}
