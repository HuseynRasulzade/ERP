import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * InventoryCountReportingService (spec sections 87-94) — read-only
 * projections over the session's own variance/entry/sheet rows. No
 * separate reporting tables: everything here is derived on demand from
 * the same rows the operational services already write.
 */
@Injectable()
export class InventoryCountReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async dashboard(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId }, include: { sheets: true, reconciliation: true } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);

    const [scopeLineCount, countedLineCount, variances, recountsPending, adjustmentLinks] = await Promise.all([
      this.prisma.inventoryCountSnapshotLine.count({ where: { tenantId, sessionId } }),
      this.prisma.inventoryCountEntry.count({ where: { tenantId, sessionId, voided: false } }),
      this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId } }),
      this.prisma.inventoryVariance.count({ where: { tenantId, sessionId, resolutionStatus: 'RECOUNT_REQUIRED' } }),
      this.prisma.inventoryCountAdjustmentLink.count({ where: { tenantId, sessionId } }),
    ]);

    const variancesExcludingMatch = variances.filter((v) => v.varianceType !== 'MATCH');
    const approved = variances.filter((v) => v.resolutionStatus === 'APPROVED' || v.resolutionStatus === 'POSTED').length;
    const posted = variances.filter((v) => v.resolutionStatus === 'POSTED').length;
    const shortageValue = variances.filter((v) => v.varianceType === 'SHORTAGE').reduce((s, v) => s + Math.abs(Number(v.valueDifference ?? 0)), 0);
    const surplusValue = variances.filter((v) => v.varianceType === 'SURPLUS').reduce((s, v) => s + Math.abs(Number(v.valueDifference ?? 0)), 0);

    return {
      sessionId,
      status: session.status,
      freezeStatus: session.freezePolicy,
      totalScopeLines: scopeLineCount,
      countedLines: countedLineCount,
      uncountedLines: variances.filter((v) => v.varianceType === 'UNCOUNTED_ITEM').length,
      recountsPending,
      varianceLines: variancesExcludingMatch.length,
      approvalsPending: variancesExcludingMatch.length - approved,
      adjustmentsPosted: posted,
      adjustmentDocumentCount: adjustmentLinks,
      shortageValue,
      surplusValue,
      percentageComplete: scopeLineCount > 0 ? Math.min(100, Math.round((countedLineCount / scopeLineCount) * 100)) : 100,
      reconciliation: session.reconciliation,
      sheetsCompleted: session.sheets.filter((s) => s.status === 'COMPLETED').length,
      sheetsTotal: session.sheets.length,
    };
  }

  async varianceReport(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);
    return this.prisma.inventoryVariance.findMany({
      where: { tenantId, sessionId, varianceType: { not: 'MATCH' } },
      include: { decision: true },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async surplusShortageReport(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);
    const variances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, varianceType: { in: ['SURPLUS', 'SHORTAGE'] } } });
    return {
      surpluses: variances.filter((v) => v.varianceType === 'SURPLUS'),
      shortages: variances.filter((v) => v.varianceType === 'SHORTAGE'),
    };
  }

  async serialVarianceReport(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);
    return this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, varianceType: { in: ['SERIAL_MISSING', 'SERIAL_UNEXPECTED'] } } });
  }

  async batchVarianceReport(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);
    return this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, varianceType: 'BATCH_MISMATCH' } });
  }

  async locationReconciliationReport(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);
    return this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, varianceType: 'LOCATION_MISMATCH' } });
  }

  async countHistoryReport(tenantId: string, membershipId: string, organizationId: string, productId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryVariance.findMany({
      where: { tenantId, productId, session: { organizationId } },
      include: { session: { select: { sessionNumber: true, snapshotAt: true } }, decision: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertSessionInOrg(tenantId: string, organizationId: string, sessionId: string) {
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
  }
}
