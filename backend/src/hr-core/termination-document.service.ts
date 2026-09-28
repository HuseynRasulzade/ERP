import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  CreateTerminationDocumentDto,
  PostTerminationDocumentDto,
  ReverseTerminationDocumentDto,
} from './dto/hr-core.dto';

const TERMINATION_TYPE = 'HR_TERMINATION_DOCUMENT';
const OPEN_STATUSES = ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE'];

/**
 * TerminationDocument (docx spec Phase 17 sections 43-49) — NEVER deletes
 * the Employee/PhysicalPerson, only closes this one Employment. An
 * employee with multiple concurrent employments (spec's own multi-
 * employment model) only becomes Employee.status = TERMINATED once every
 * one of their employments is closed — terminating one SECONDARY
 * employment leaves the Employee (and any other open employment) ACTIVE.
 */
@Injectable()
export class TerminationDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    employmentId?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.terminationDocument.findMany({
          where: {
            employment: { organizationId },
            ...(employmentId ? { employmentId } : {}),
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.terminationDocument.findFirst({
      where: { id, employment: { organizationId } },
    });
    if (!row) throw new NotFoundAppError('TerminationDocument', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateTerminationDocumentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: dto.employmentId, organizationId },
    });
    if (!employment)
      throw new ValidationAppError(
        'employmentId does not belong to this organization',
      );
    if (!OPEN_STATUSES.includes(employment.status))
      throw new ValidationAppError(
        `Cannot terminate an employment in status ${employment.status}`,
      );

    const terminationDate = this.parseDate(dto.terminationDate);
    const lastWorkingDate = this.parseDate(dto.lastWorkingDate);
    if (lastWorkingDate > terminationDate)
      throw new ValidationAppError(
        'lastWorkingDate cannot be after terminationDate',
      );

    const existingOpen = await this.prisma.terminationDocument.findFirst({
      where: {
        employmentId: dto.employmentId,
        status: { in: ['DRAFT', 'POSTED'] },
      },
    });
    if (existingOpen)
      throw new ValidationAppError(
        'This employment already has an open termination document',
      );

    const doc = await this.prisma.terminationDocument.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        terminationDate,
        lastWorkingDate,
        terminationReason: dto.terminationReason,
        legalBasis: dto.legalBasis,
        noticeDate: dto.noticeDate ? this.parseDate(dto.noticeDate) : undefined,
        responsibleHrUserId: dto.responsibleHrUserId,
        comment: dto.comment,
        createdBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'HR_TERMINATION_CREATED',
      entityType: TERMINATION_TYPE,
      entityId: doc.id,
      action: 'CREATE',
      userId,
    });
    return doc;
  }

  async post(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: PostTerminationDocumentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const doc = await this.get(tenantId, membershipId, organizationId, id);
    if (doc.status !== 'DRAFT')
      throw new ValidationAppError(
        `Cannot post a termination document in status ${doc.status}`,
      );
    if (doc.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { id: doc.employmentId },
      });
      if (!employment)
        throw new NotFoundAppError('Employment', doc.employmentId);

      await tx.employeeAssignment.updateMany({
        where: { employmentId: doc.employmentId, effectiveTo: null },
        data: { effectiveTo: doc.lastWorkingDate },
      });
      await tx.employmentStatusHistory.updateMany({
        where: { employmentId: doc.employmentId, effectiveTo: null },
        data: { effectiveTo: doc.lastWorkingDate },
      });
      await tx.employmentStatusHistory.create({
        data: {
          tenantId,
          employmentId: doc.employmentId,
          status: 'TERMINATED',
          effectiveFrom: doc.terminationDate,
          reason: doc.terminationReason,
          sourceDocumentType: TERMINATION_TYPE,
          sourceDocumentId: doc.id,
        },
      });

      await tx.employment.update({
        where: { id: doc.employmentId },
        data: {
          status: 'TERMINATED',
          employmentEndDate: doc.terminationDate,
          version: { increment: 1 },
        },
      });

      const otherOpen = await tx.employment.findFirst({
        where: {
          employeeId: employment.employeeId,
          id: { not: doc.employmentId },
          status: { in: OPEN_STATUSES },
        },
      });
      await tx.employee.update({
        where: { id: employment.employeeId },
        data: {
          status: otherOpen ? 'ACTIVE' : 'TERMINATED',
          lastTerminationDate: doc.terminationDate,
        },
      });

      const result = await tx.terminationDocument.updateMany({
        where: { id, version: dto.expectedVersion },
        data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_TERMINATION_POSTED',
          entityType: TERMINATION_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
        },
        tx,
      );
      return tx.terminationDocument.findFirst({ where: { id } });
    });
  }

  async reverse(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ReverseTerminationDocumentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const doc = await this.get(tenantId, membershipId, organizationId, id);
    if (doc.status !== 'POSTED')
      throw new ValidationAppError(
        `Cannot reverse a termination document in status ${doc.status}`,
      );
    if (doc.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { id: doc.employmentId },
      });
      if (!employment)
        throw new NotFoundAppError('Employment', doc.employmentId);
      if (employment.status !== 'TERMINATED')
        throw new ValidationAppError(
          'Employment status has changed since termination — cannot auto-reverse',
        );

      await tx.employmentStatusHistory.deleteMany({
        where: {
          employmentId: doc.employmentId,
          sourceDocumentType: TERMINATION_TYPE,
          sourceDocumentId: doc.id,
        },
      });
      await tx.employeeAssignment.updateMany({
        where: {
          employmentId: doc.employmentId,
          effectiveTo: doc.lastWorkingDate,
        },
        data: { effectiveTo: null },
      });
      await tx.employmentStatusHistory.updateMany({
        where: {
          employmentId: doc.employmentId,
          effectiveTo: doc.lastWorkingDate,
        },
        data: { effectiveTo: null },
      });

      await tx.employment.update({
        where: { id: doc.employmentId },
        data: {
          status: 'ACTIVE',
          employmentEndDate: null,
          version: { increment: 1 },
        },
      });
      await tx.employee.update({
        where: { id: employment.employeeId },
        data: { status: 'ACTIVE' },
      });

      const result = await tx.terminationDocument.updateMany({
        where: { id, version: dto.expectedVersion },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedBy: userId,
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_TERMINATION_REVERSED',
          entityType: TERMINATION_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
        },
        tx,
      );
      return tx.terminationDocument.findFirst({ where: { id } });
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
