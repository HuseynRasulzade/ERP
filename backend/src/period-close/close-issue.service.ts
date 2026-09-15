import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * CloseIssueService (docx spec Phase 22, sections 86-89). BLOCKING
 * issues cannot be waived by default (spec section 89) — only
 * ACCEPTED_EXCEPTION via an explicit reason, and only when the caller
 * holds `PERIOD_CLOSE_WAIVE_WARNING` (enforced at the controller).
 */
@Injectable()
export class CloseIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, closeRunId: string, dto: { stepId?: string; issueCode: string; severity: string; blocking: boolean; sourceModule?: string; sourceEntity?: string; description: string; suggestedAction?: string; assignedTo?: string }) {
    return this.prisma.periodCloseIssue.create({
      data: { tenantId, closeRunId, stepId: dto.stepId, issueCode: dto.issueCode, severity: dto.severity, blocking: dto.blocking, sourceModule: dto.sourceModule, sourceEntity: dto.sourceEntity, description: dto.description, suggestedAction: dto.suggestedAction, assignedTo: dto.assignedTo, status: 'OPEN' },
    });
  }

  list(tenantId: string, closeRunId: string) {
    return this.prisma.periodCloseIssue.findMany({ where: { tenantId, closeRunId }, orderBy: [{ blocking: 'desc' }, { severity: 'desc' }] });
  }

  async resolve(tenantId: string, userId: string, issueId: string, note?: string) {
    const issue = await this.get(tenantId, issueId);
    const updated = await this.prisma.periodCloseIssue.update({ where: { id: issue.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: userId, resolutionNote: note } });
    await this.audit.record({ tenantId, eventType: 'CLOSE_ISSUE_RESOLVED', entityType: 'PeriodCloseIssue', entityId: issue.id, action: 'UPDATE', userId, reason: note });
    return updated;
  }

  /** A BLOCKING issue can only become ACCEPTED_EXCEPTION, never silently
   * WAIVED as if it were a plain warning (spec section 89) — the caller
   * (controller) is responsible for checking the waiver permission. */
  async waive(tenantId: string, userId: string, issueId: string, reason: string) {
    if (!reason) throw new ValidationAppError('A waiver requires an explicit reason (spec section 88)');
    const issue = await this.get(tenantId, issueId);
    const status = issue.blocking ? 'ACCEPTED_EXCEPTION' : 'WAIVED';
    const updated = await this.prisma.periodCloseIssue.update({ where: { id: issue.id }, data: { status, resolvedAt: new Date(), resolvedBy: userId, resolutionNote: reason } });
    await this.audit.record({ tenantId, eventType: 'CLOSE_ISSUE_WAIVED', entityType: 'PeriodCloseIssue', entityId: issue.id, action: 'UPDATE', userId, reason });
    return updated;
  }

  async blockingCount(tenantId: string, closeRunId: string): Promise<number> {
    return this.prisma.periodCloseIssue.count({ where: { tenantId, closeRunId, blocking: true, status: { in: ['OPEN', 'IN_REVIEW'] } } });
  }

  private async get(tenantId: string, id: string) {
    const issue = await this.prisma.periodCloseIssue.findFirst({ where: { id, tenantId } });
    if (!issue) throw new NotFoundAppError('PeriodCloseIssue', id);
    return issue;
  }
}
