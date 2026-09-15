import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedApprover {
  userId: string;
  employmentId?: string;
  resolvedFromRule: string;
}

export interface ApproverResolutionContext {
  employmentId?: string; // the requester's own employment, for MANAGER/MANAGER_N_LEVELS/DEPARTMENT_HEAD
  departmentId?: string;
  costCenterId?: string;
  // Always injected server-side from the workflow instance's own
  // `organizationId`/business date before resolution runs — never
  // trusted from a caller-supplied context bag — hence optional here
  // (a caller building a context for `simulate`/`start` need not know
  // to set these; the orchestrator fills them in).
  organizationId?: string;
  businessDate?: Date;
}

/**
 * ApproverResolutionService (docx spec Phase 26, sections 26-31, 88-90).
 * Resolves an `ApproverRule` into concrete `userId`s at ASSIGNMENT time
 * only — once resolved, the assignment snapshots
 * `resolvedFromRule`/`userId` and is never silently re-resolved just
 * because org structure changes the next day (spec section 34). Manager
 * resolution walks `Employment.managerEmploymentId` directly (Phase 17)
 * and maps to a `userId` via the Phase 26 `Employee.linkedUserId`
 * bridge — an employment whose employee has no linked user account
 * cannot be resolved as an approver (spec section 88's own "block, do
 * not silently skip").
 */
@Injectable()
export class ApproverResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, rule: { id: string; code: string; ruleType: string; specificUserId?: string | null; roleCode?: string | null; managerLevels?: number | null; fallbackRuleId?: string | null }, context: ApproverResolutionContext): Promise<ResolvedApprover[]> {
    const resolved = await this.resolveByType(tenantId, rule, context);
    if (resolved.length > 0) return resolved;
    if (rule.fallbackRuleId) {
      const fallbackRule = await this.prisma.approverRule.findFirst({ where: { id: rule.fallbackRuleId, tenantId } });
      if (fallbackRule) return this.resolve(tenantId, fallbackRule, context); // spec section 90 — explicit fallback only
    }
    return [];
  }

  private async resolveByType(tenantId: string, rule: { code: string; ruleType: string; specificUserId?: string | null; roleCode?: string | null; managerLevels?: number | null }, context: ApproverResolutionContext): Promise<ResolvedApprover[]> {
    switch (rule.ruleType) {
      case 'SPECIFIC_USER':
        return rule.specificUserId ? [{ userId: rule.specificUserId, resolvedFromRule: rule.code }] : [];

      case 'ROLE':
      case 'ORGANIZATION_ROLE': {
        if (!rule.roleCode || !context.organizationId) return [];
        const role = await this.prisma.role.findFirst({ where: { tenantId, code: rule.roleCode } });
        if (!role) return [];
        const holders = await this.prisma.membershipRole.findMany({
          where: { roleId: role.id, membership: { tenantId, status: 'ACTIVE', organizationAccess: { some: { organizationId: context.organizationId } } } },
          include: { membership: true },
        });
        return holders.map((h) => ({ userId: h.membership.userId, resolvedFromRule: rule.code }));
      }

      case 'MANAGER': {
        const manager = await this.resolveManagerChain(tenantId, context.employmentId, 1);
        return manager ? [{ ...manager, resolvedFromRule: rule.code }] : [];
      }

      case 'MANAGER_N_LEVELS': {
        const manager = await this.resolveManagerChain(tenantId, context.employmentId, rule.managerLevels ?? 1);
        return manager ? [{ ...manager, resolvedFromRule: rule.code }] : [];
      }

      case 'DEPARTMENT_HEAD': {
        if (!context.departmentId) return [];
        const department = await this.prisma.department.findFirst({ where: { id: context.departmentId, tenantId } });
        if (!department?.managerPersonId) return [];
        const responsiblePerson = await this.prisma.responsiblePerson.findFirst({ where: { id: department.managerPersonId, tenantId } });
        return responsiblePerson?.userId ? [{ userId: responsiblePerson.userId, resolvedFromRule: rule.code }] : [];
      }

      case 'COST_CENTER_OWNER': {
        if (!context.costCenterId) return [];
        const costCenter = await this.prisma.costCenter.findFirst({ where: { id: context.costCenterId, tenantId } });
        if (!costCenter?.responsiblePersonId) return [];
        const responsiblePerson = await this.prisma.responsiblePerson.findFirst({ where: { id: costCenter.responsiblePersonId, tenantId } });
        return responsiblePerson?.userId ? [{ userId: responsiblePerson.userId, resolvedFromRule: rule.code }] : [];
      }

      case 'DOCUMENT_OWNER_MANAGER': {
        const manager = await this.resolveManagerChain(tenantId, context.employmentId, 1);
        return manager ? [{ ...manager, resolvedFromRule: rule.code }] : [];
      }

      case 'PROJECT_MANAGER':
      case 'DYNAMIC_QUERY_RULE':
        // No `Project` master table or governed dynamic-query surface
        // exists in this codebase (project is a soft reference
        // everywhere, per Phase 17/20/24's own established convention)
        // — disclosed, docs/WORKFLOW_ENGINE.md section B.
        return [];

      default:
        return [];
    }
  }

  /** Walks `Employment.managerEmploymentId` N levels up, detecting
   * cycles (spec sections 28, 86 — CIRCULAR_MANAGER_CHAIN). */
  private async resolveManagerChain(tenantId: string, employmentId: string | undefined, levels: number): Promise<{ userId: string; employmentId: string } | null> {
    if (!employmentId) return null;
    let current = employmentId;
    const seen = new Set<string>([current]);
    for (let i = 0; i < levels; i++) {
      const employment = await this.prisma.employment.findFirst({ where: { id: current, tenantId }, select: { managerEmploymentId: true } });
      if (!employment?.managerEmploymentId) return null;
      if (seen.has(employment.managerEmploymentId)) return null; // circular chain — resolve to "no approver" (blocking, not silent)
      seen.add(employment.managerEmploymentId);
      current = employment.managerEmploymentId;
    }
    const managerEmployment = await this.prisma.employment.findFirst({ where: { id: current, tenantId }, include: { employee: true } });
    if (!managerEmployment?.employee.linkedUserId) return null;
    return { userId: managerEmployment.employee.linkedUserId, employmentId: managerEmployment.id };
  }
}
