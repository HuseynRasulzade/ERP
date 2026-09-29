import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { UploadExpenseReceiptDto } from './dto/expenses.dto';

/**
 * ExpenseReceiptService (docx spec Phase 20 sections 14-18) — supporting
 * documents. Duplicate detection (spec section 18) matches on (supplier,
 * documentNumber, documentDate, amount) or an equal `attachmentHash`;
 * either match BLOCKS the upload outright (spec: "Silent approval etmə"
 * — a duplicate is never silently accepted then merely flagged).
 */
@Injectable()
export class ExpenseReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async listForLine(tenantId: string, membershipId: string, organizationId: string, claimLineId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.assertLineInOrg(tenantId, organizationId, claimLineId);
    return this.prisma.expenseReceipt.findMany({ where: { claimLineId: line.id } });
  }

  async upload(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: UploadExpenseReceiptDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertLineInOrg(tenantId, organizationId, dto.claimLineId);

    const duplicate = await this.findDuplicate(tenantId, dto);
    if (duplicate)
      throw new ValidationAppError(
        `Duplicate receipt: supplier/document number/date/amount already recorded on receipt ${duplicate.id}`,
      );

    const created = await this.prisma.expenseReceipt.create({
      data: {
        tenantId,
        claimLineId: dto.claimLineId,
        fileId: dto.fileId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        supplier: dto.supplier,
        supplierTaxId: dto.supplierTaxId,
        documentDate: dto.documentDate ? new Date(dto.documentDate) : undefined,
        amount: dto.amount,
        currencyId: dto.currencyId,
        taxAmount: dto.taxAmount,
        attachmentHash: dto.attachmentHash,
        uploadedBy: userId,
        validationStatus: 'REVIEW_REQUIRED',
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'EXPENSE_RECEIPT_UPLOADED',
      entityType: 'EXPENSE_RECEIPT',
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { claimLineId: dto.claimLineId, documentNumber: dto.documentNumber },
    });
    return created;
  }

  async review(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    validationStatus: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const receipt = await this.prisma.expenseReceipt.findFirst({ where: { id, tenantId } });
    if (!receipt) throw new NotFoundAppError('ExpenseReceipt', id);
    const updated = await this.prisma.expenseReceipt.update({ where: { id }, data: { validationStatus } });
    await this.audit.record({
      tenantId,
      eventType: 'EXPENSE_RECEIPT_REVIEWED',
      entityType: 'EXPENSE_RECEIPT',
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { validationStatus },
    });
    return updated;
  }

  private async findDuplicate(tenantId: string, dto: UploadExpenseReceiptDto) {
    if (dto.attachmentHash) {
      const byHash = await this.prisma.expenseReceipt.findFirst({
        where: { tenantId, attachmentHash: dto.attachmentHash },
      });
      if (byHash) return byHash;
    }
    if (dto.supplier && dto.documentNumber && dto.documentDate && dto.amount !== undefined) {
      return this.prisma.expenseReceipt.findFirst({
        where: {
          tenantId,
          supplier: dto.supplier,
          documentNumber: dto.documentNumber,
          documentDate: new Date(dto.documentDate),
          amount: dto.amount,
        },
      });
    }
    return null;
  }

  private async assertLineInOrg(tenantId: string, organizationId: string, claimLineId: string) {
    const line = await this.prisma.expenseClaimLine.findFirst({
      where: { id: claimLineId, tenantId, claim: { organizationId } },
    });
    if (!line) throw new NotFoundAppError('ExpenseClaimLine', claimLineId);
    return line;
  }
}
