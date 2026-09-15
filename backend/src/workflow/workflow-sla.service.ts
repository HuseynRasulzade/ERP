import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WorkflowSLAService (docx spec Phase 26, sections 66-68). Deadlines
 * are stored durably on each `ApproverAssignment`/`WorkflowStepInstance`
 * row at activation time (`workflow-instance.service.ts`), not computed
 * on the fly — a scheduled job calling `findBreached` is restart-safe
 * (spec section 73) since the deadline itself already survived any
 * crash. Business-hours/working-day SLA calendars (spec section 67) are
 * not implemented — every duration is plain calendar hours (disclosed,
 * docs/WORKFLOW_ENGINE.md section E).
 */
@Injectable()
export class WorkflowSLAService {
  constructor(private readonly prisma: PrismaService) {}

  async findOverdue(tenantId: string) {
    return this.prisma.workflowStepInstance.findMany({ where: { tenantId, status: 'ACTIVE', deadline: { lt: new Date() } }, include: { assignments: { where: { status: 'PENDING' } }, definition: true, instance: true } });
  }

  async findDueWithin(tenantId: string, hours: number) {
    return this.prisma.workflowStepInstance.findMany({ where: { tenantId, status: 'ACTIVE', deadline: { lte: new Date(Date.now() + hours * 3600000), gte: new Date() } }, include: { assignments: { where: { status: 'PENDING' } } } });
  }
}
