import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { HR_TERMINATION_TYPE } from './termination.repository';

const SEQUENCE_PREFIX = 'TERM';

@Injectable()
export class TerminationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { employmentId: string; terminationDate: string; lastWorkingDate?: string; terminationReason: string; legalReference?: string; noticeDate?: string; comment?: string; responsibleHrUserId?: string; documentDate: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, organizationId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const documentDate = this.parseDate(dto.documentDate);
    const terminationDate = this.parseDate(dto.terminationDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, HR_TERMINATION_TYPE, documentDate, tx);
      const row = await tx.terminationDocument.create({
        data: {
          tenantId,
          organizationId,
          employmentId: dto.employmentId,
          terminationDate,
          lastWorkingDate: dto.lastWorkingDate ? new Date(dto.lastWorkingDate) : undefined,
          terminationReason: dto.terminationReason,
          legalReference: dto.legalReference,
          noticeDate: dto.noticeDate ? new Date(dto.noticeDate) : undefined,
          comment: dto.comment,
          responsibleHrUserId: dto.responsibleHrUserId,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'HR_TERMINATION_CREATED', entityType: HR_TERMINATION_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { terminationDate: dto.terminationDate, terminationReason: dto.terminationReason } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.terminationDocument.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: HR_TERMINATION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: HR_TERMINATION_TYPE, documentType: HR_TERMINATION_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
