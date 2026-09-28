import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface HrHealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  employmentId: string | null;
  documentType: string | null;
  documentId: string | null;
  message: string;
}

const STALE_DAYS = 30;

/**
 * HrHealthService (docx spec Phase 17 section 51) — computed live, same
 * principle as every other *HealthService in this codebase. Covers a
 * practical subset of the spec's own checklist.
 */
@Injectable()
export class HrHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async check(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ): Promise<HrHealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: HrHealthIssue[] = [];
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000);

    const staleHires = await this.prisma.hireDocument.findMany({
      where: {
        organizationId,
        status: 'DRAFT',
        createdAt: { lt: staleCutoff },
      },
    });
    for (const h of staleHires) {
      issues.push({
        severity: 'WARNING',
        code: 'STALE_UNPOSTED_HIRE',
        employmentId: null,
        documentType: 'HR_HIRE_DOCUMENT',
        documentId: h.id,
        message: `Hire document ${h.id} has been unposted for over ${STALE_DAYS} days`,
      });
    }

    const staleTerminations = await this.prisma.terminationDocument.findMany({
      where: {
        status: 'DRAFT',
        createdAt: { lt: staleCutoff },
        employment: { organizationId },
      },
    });
    for (const t of staleTerminations) {
      issues.push({
        severity: 'WARNING',
        code: 'STALE_UNPOSTED_TERMINATION',
        employmentId: t.employmentId,
        documentType: 'HR_TERMINATION_DOCUMENT',
        documentId: t.id,
        message: `Termination document ${t.id} has been unposted for over ${STALE_DAYS} days`,
      });
    }

    const activeEmployments = await this.prisma.employment.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: { contract: true },
    });
    for (const e of activeEmployments) {
      if (!e.contract)
        issues.push({
          severity: 'WARNING',
          code: 'MISSING_CONTRACT',
          employmentId: e.id,
          documentType: 'HR_EMPLOYMENT',
          documentId: e.id,
          message: `Active employment ${e.id} has no employment contract on file`,
        });
      if (e.probationEndDate && e.probationEndDate < now)
        issues.push({
          severity: 'INFO',
          code: 'PROBATION_OVERDUE',
          employmentId: e.id,
          documentType: 'HR_EMPLOYMENT',
          documentId: e.id,
          message: `Employment ${e.id} is past its probation end date without a recorded outcome`,
        });
    }

    const overCapacity: string[] = [];
    const staffingPositions = await this.prisma.staffingPosition.findMany({
      where: { organizationId, status: 'ACTIVE' },
    });
    for (const sp of staffingPositions) {
      const employments = await this.prisma.employment.findMany({
        where: {
          staffingPositionId: sp.id,
          status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE'] },
        },
      });
      const usedFte = employments.reduce((sum, e) => sum + Number(e.fte), 0);
      if (
        employments.length > Number(sp.headcountLimit) ||
        usedFte > Number(sp.fteLimit) + 0.0001
      ) {
        overCapacity.push(sp.id);
        issues.push({
          severity: 'ERROR',
          code: 'STAFFING_POSITION_OVER_CAPACITY',
          employmentId: null,
          documentType: 'HR_STAFFING_POSITION',
          documentId: sp.id,
          message: `Staffing position ${sp.id} exceeds its headcount/FTE limit (${employments.length}/${sp.headcountLimit} headcount, ${usedFte}/${sp.fteLimit} FTE)`,
        });
      }
    }

    const activePersons = await this.prisma.physicalPerson.findMany({
      where: { tenantId, active: true, personalId: { not: null } },
      select: { personalId: true },
    });
    const personalIdCounts = new Map<string, number>();
    for (const p of activePersons) {
      if (!p.personalId) continue;
      personalIdCounts.set(
        p.personalId,
        (personalIdCounts.get(p.personalId) ?? 0) + 1,
      );
    }
    for (const [personalId, count] of personalIdCounts) {
      if (count <= 1) continue;
      issues.push({
        severity: 'ERROR',
        code: 'DUPLICATE_PERSONAL_ID',
        employmentId: null,
        documentType: 'PHYSICAL_PERSON',
        documentId: null,
        message: `Multiple active physical persons share personalId ${personalId}`,
      });
    }

    return issues;
  }
}
