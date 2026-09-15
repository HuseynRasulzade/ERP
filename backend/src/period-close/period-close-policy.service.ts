import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface EffectiveClosePolicy {
  requireBankReconciliation: boolean;
  requireCashDailyClose: boolean;
  requireInventoryCostFinalization: boolean;
  requireInventoryCount: boolean;
  requirePayrollClose: boolean;
  requireFaDepreciation: boolean;
  requirePrepaidRecognition: boolean;
  requireProductionCosting: boolean;
  requireFxRevaluation: boolean;
  toleranceProfile: string;
  softCloseAllowed: boolean;
  reopenPolicy: string;
  approvalProfile?: string;
}

const DEFAULT_POLICY: EffectiveClosePolicy = {
  requireBankReconciliation: true,
  requireCashDailyClose: true,
  requireInventoryCostFinalization: true,
  requireInventoryCount: false,
  requirePayrollClose: true,
  requireFaDepreciation: true,
  requirePrepaidRecognition: true,
  requireProductionCosting: true,
  requireFxRevaluation: true,
  toleranceProfile: 'STANDARD',
  softCloseAllowed: true,
  reopenPolicy: 'APPROVAL_REQUIRED',
};

/**
 * PeriodClosePolicyService (docx spec Phase 22, section 17). Org-specific
 * policy overrides tenant-wide default (organizationId = null); most
 * recent `effectiveFrom` on-or-before the period's start wins.
 */
@Injectable()
export class PeriodClosePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(tenantId: string, userId: string, dto: { organizationId?: string; effectiveFrom: string; effectiveTo?: string } & Partial<EffectiveClosePolicy>) {
    return this.prisma.periodClosePolicy.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        requireBankReconciliation: dto.requireBankReconciliation,
        requireCashDailyClose: dto.requireCashDailyClose,
        requireInventoryCostFinalization: dto.requireInventoryCostFinalization,
        requireInventoryCount: dto.requireInventoryCount,
        requirePayrollClose: dto.requirePayrollClose,
        requireFaDepreciation: dto.requireFaDepreciation,
        requirePrepaidRecognition: dto.requirePrepaidRecognition,
        requireProductionCosting: dto.requireProductionCosting,
        requireFxRevaluation: dto.requireFxRevaluation,
        toleranceProfile: dto.toleranceProfile,
        softCloseAllowed: dto.softCloseAllowed,
        reopenPolicy: dto.reopenPolicy,
        approvalProfile: dto.approvalProfile,
        createdBy: userId,
      },
    });
  }

  async resolve(tenantId: string, organizationId: string, asOfDate: Date): Promise<EffectiveClosePolicy> {
    const candidate = await this.prisma.periodClosePolicy.findFirst({
      where: {
        tenantId,
        OR: [{ organizationId }, { organizationId: null }],
        effectiveFrom: { lte: asOfDate },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] }],
      },
      orderBy: [{ organizationId: 'asc' }, { effectiveFrom: 'desc' }], // org-specific over tenant-wide, then most recent
    });
    if (!candidate) return DEFAULT_POLICY;
    return {
      requireBankReconciliation: candidate.requireBankReconciliation,
      requireCashDailyClose: candidate.requireCashDailyClose,
      requireInventoryCostFinalization: candidate.requireInventoryCostFinalization,
      requireInventoryCount: candidate.requireInventoryCount,
      requirePayrollClose: candidate.requirePayrollClose,
      requireFaDepreciation: candidate.requireFaDepreciation,
      requirePrepaidRecognition: candidate.requirePrepaidRecognition,
      requireProductionCosting: candidate.requireProductionCosting,
      requireFxRevaluation: candidate.requireFxRevaluation,
      toleranceProfile: candidate.toleranceProfile,
      softCloseAllowed: candidate.softCloseAllowed,
      reopenPolicy: candidate.reopenPolicy,
    };
  }
}
