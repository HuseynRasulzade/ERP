import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PAYROLL_POSTING_TYPE } from './payroll-posting.repository';

const SEQUENCE_PREFIX = 'PRP';
const ENTITY_TYPE = 'PAYROLL_POSTING';

/**
 * PayrollPostingService — drafts the PayrollPosting document for a period
 * (docx spec Phase 19 sections 97-103). Creating it never touches the GL
 * or the liability register by itself: posting it via the generic
 * `POST documents/PAYROLL_POSTING/:id/post` command (DocumentPostingService)
 * is what runs PayrollPostingHandler and produces the balanced journal
 * entry + register movements, inside one transaction.
 */
@Injectable()
export class PayrollPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async get(tenantId: string, membershipId: string, organizationId: string, periodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.payrollPosting.findFirst({ where: { payrollPeriodId: periodId, organizationId } });
    if (!row) throw new NotFoundAppError('PayrollPosting', periodId);
    return row;
  }

  async createForPeriod(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    periodId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', periodId);
    if (period.status !== 'APPROVED')
      throw new ValidationAppError(
        `Cannot create a GL posting for a payroll period in status ${period.status} — approve it first`,
      );

    const existing = await this.prisma.payrollPosting.findUnique({ where: { payrollPeriodId: periodId } });
    if (existing)
      throw new ValidationAppError('A PayrollPosting already exists for this period — post/unpost it, never create a second one');

    const results = await this.prisma.payrollCalculationResult.findMany({
      where: { tenantId, payrollPeriodId: periodId, status: 'CALCULATED' },
    });
    if (results.length === 0) throw new ValidationAppError('No calculated payroll results to post for this period');

    const totals = results.reduce(
      (acc, r) => ({
        gross: acc.gross.plus(r.gross.toString()),
        net: acc.net.plus(r.net.toString()),
        employerContributions: acc.employerContributions.plus(r.employerContributions.toString()),
      }),
      { gross: new Decimal(0), net: new Decimal(0), employerContributions: new Decimal(0) },
    );

    await this.ensureSequence(tenantId);
    const created = await this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PAYROLL_POSTING_TYPE, period.periodEnd, tx);
      return tx.payrollPosting.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          payrollPeriodId: periodId,
          documentDate: period.periodEnd,
          employeeCount: results.length,
          totalGross: totals.gross,
          totalNet: totals.net,
          totalEmployerContributions: totals.employerContributions,
          description: `Payroll posting for ${period.year}-${String(period.month).padStart(2, '0')}`,
          createdBy: userId,
        },
      });
    });

    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_POSTING_CREATED',
      entityType: ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { payrollPeriodId: periodId, employeeCount: results.length },
    });
    return created;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: PAYROLL_POSTING_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: PAYROLL_POSTING_TYPE,
          documentType: PAYROLL_POSTING_TYPE,
          prefix: SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race — fine.
    }
  }
}
