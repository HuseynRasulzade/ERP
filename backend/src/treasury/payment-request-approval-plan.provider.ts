import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import {
  ApprovalPlanProvider,
  ApprovalStepPlanItem,
  ApprovalStepType,
} from '../approvals/approval-plan.interface';
import { userHasRole } from '../approvals/role-resolution.util';
import { PAYMENT_REQUEST_TYPE } from './payment-request.service';

const ROLE_BY_STEP: Partial<Record<ApprovalStepType, string>> = {
  DEPARTMENT_HEAD: 'DEPARTMENT_HEAD',
  FINANCE: 'FINANCE_USER',
  DIRECTOR: 'DIRECTOR',
};

/**
 * Payment Request approval plan (docx spec Phase 14, sections 11-13) — an
 * amount-tier ladder read from `TreasuryPaymentApprovalRule`, never
 * hardcoded (spec: "Rules hard-coded olmamalıdır"). A tenant/organization
 * with NO rules configured plans zero steps (NOT_REQUIRED) — every
 * existing zero-config PaymentRequest flow this codebase already had
 * keeps working unchanged; configuring rows here is what turns the gate
 * on. Step types reuse the existing shared ApprovalStepType enum
 * (DEPARTMENT_HEAD/FINANCE/DIRECTOR) rather than inventing
 * "Department Manager"/"CFO" — see docs/TREASURY.md.
 */
@Injectable()
export class PaymentRequestApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = PAYMENT_REQUEST_TYPE;

  async loadDocument(
    tenantId: string,
    documentId: string,
    tx: PrismaTransactionClient,
  ) {
    return tx.paymentRequest.findFirst({ where: { id: documentId, tenantId } });
  }

  async setApprovalStatus(
    tenantId: string,
    documentId: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED',
    tx: PrismaTransactionClient,
  ) {
    await tx.paymentRequest.update({
      where: { id: documentId },
      data: { approvalStatus: status },
    });
  }

  async planSteps(
    tenantId: string,
    organizationId: string,
    document: any,
    tx: PrismaTransactionClient,
  ): Promise<ApprovalStepPlanItem[]> {
    const amount = new Decimal(document.amount.toString());
    const rules = await tx.treasuryPaymentApprovalRule.findMany({
      where: {
        tenantId,
        active: true,
        OR: [{ organizationId }, { organizationId: null }],
        AND: [{ OR: [{ category: document.category }, { category: null }] }],
      },
      orderBy: { sequence: 'asc' },
    });

    // Organization-specific rules take precedence over tenant-wide ones for
    // the same category, mirroring AccountingMappingService.resolve's own
    // specificity precedence.
    const orgSpecific = rules.filter(
      (r) => r.organizationId === organizationId,
    );
    const pool = orgSpecific.length > 0 ? orgSpecific : rules;

    const matching = pool.filter((r) => {
      const min = new Decimal(r.minAmount.toString());
      const max =
        r.maxAmount != null ? new Decimal(r.maxAmount.toString()) : null;
      return amount.gte(min) && (max === null || amount.lte(max));
    });

    return matching.map((r, i) => ({
      sequence: i + 1,
      stepType: r.stepType as ApprovalStepType,
    }));
  }

  async resolveApprover(
    tenantId: string,
    _organizationId: string,
    stepType: ApprovalStepType,
    _document: any,
    userId: string,
    tx: PrismaTransactionClient,
  ): Promise<boolean> {
    const roleCode = ROLE_BY_STEP[stepType];
    if (!roleCode) return false;
    return userHasRole(tenantId, userId, roleCode, tx);
  }

  getCreatedBy(document: any): string | null {
    return document.createdBy ?? null;
  }
}
