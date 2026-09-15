import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * PaymentInstructionService (spec sections 23-25). Not a
 * DocumentFramework document — it never posts accounting or moves cash
 * (spec section 25: "Payment Instruction is NOT bank execution"); its own
 * status lifecycle tracks the bank submission handshake only.
 * `SettlementPaymentPostingHandler`/`BankPaymentService` reference it via
 * `paymentInstructionId` once the actual `SettlementPayment` posts.
 */
@Injectable()
export class PaymentInstructionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { paymentRequestId: string; bankAccountId: string; beneficiaryName?: string; beneficiaryBankDetails?: string; currencyId: string; amount: number; executionDate?: string; purpose?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const request = await this.prisma.paymentRequest.findFirst({ where: { id: dto.paymentRequestId, tenantId, organizationId } });
    if (!request) throw new NotFoundAppError('PaymentRequest', dto.paymentRequestId);
    if (!['APPROVED', 'PARTIALLY_APPROVED', 'PARTIALLY_PAID'].includes(request.status)) {
      throw new ValidationAppError('A payment instruction can only be created from an approved payment request');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.paymentInstruction.create({
        data: { tenantId, organizationId, paymentRequestId: dto.paymentRequestId, bankAccountId: dto.bankAccountId, beneficiaryName: dto.beneficiaryName, beneficiaryBankDetails: dto.beneficiaryBankDetails, currencyId: dto.currencyId, amount: dto.amount.toString(), executionDate: dto.executionDate ? new Date(dto.executionDate) : undefined, purpose: dto.purpose, status: 'DRAFT', createdBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_INSTRUCTION_CREATED', entityType: 'PAYMENT_INSTRUCTION', entityId: row.id, action: 'CREATE', userId, newValues: { amount: dto.amount } }, tx);
      return row;
    });
  }

  async transition(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, status: string, bankReference?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.paymentInstruction.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('PaymentInstruction', id);
    return this.prisma.paymentInstruction.update({ where: { id }, data: { status, bankReference: bankReference ?? row.bankReference } });
  }

  list(tenantId: string, organizationId: string, paymentRequestId?: string) {
    return this.prisma.paymentInstruction.findMany({ where: { tenantId, organizationId, paymentRequestId }, orderBy: { createdAt: 'desc' } });
  }
}
