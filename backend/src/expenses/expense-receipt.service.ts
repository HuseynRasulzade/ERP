import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** ExpenseReceiptService (spec sections 14-18). `checkDuplicates` is
 * advisory (warning), never an automatic block — a genuine duplicate
 * business trip receipt across two employees' claims is rare but
 * possible and must stay reviewable by a human. */
@Injectable()
export class ExpenseReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async attach(tenantId: string, userId: string, dto: { claimLineId: string; assetId?: string; documentType: string; documentNumber?: string; supplier?: string; supplierTaxId?: string; documentDate?: string; amount?: number; currencyId?: string; attachmentHash?: string }) {
    const line = await this.prisma.expenseClaimLine.findFirst({ where: { id: dto.claimLineId, tenantId } });
    if (!line) throw new NotFoundAppError('ExpenseClaimLine', dto.claimLineId);

    let validationStatus = 'VALID';
    if (dto.supplier && dto.documentNumber && dto.amount != null) {
      const duplicate = await this.prisma.expenseReceipt.findFirst({ where: { tenantId, supplier: dto.supplier, documentNumber: dto.documentNumber, amount: dto.amount.toString(), NOT: { claimLineId: dto.claimLineId } } });
      if (duplicate) validationStatus = 'DUPLICATE_SUSPECTED';
    } else if (dto.attachmentHash) {
      const duplicate = await this.prisma.expenseReceipt.findFirst({ where: { tenantId, attachmentHash: dto.attachmentHash, NOT: { claimLineId: dto.claimLineId } } });
      if (duplicate) validationStatus = 'DUPLICATE_SUSPECTED';
    }

    const row = await this.prisma.expenseReceipt.create({
      data: {
        tenantId,
        claimLineId: dto.claimLineId,
        assetId: dto.assetId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        supplier: dto.supplier,
        supplierTaxId: dto.supplierTaxId,
        documentDate: dto.documentDate ? new Date(dto.documentDate) : undefined,
        amount: dto.amount?.toString(),
        currencyId: dto.currencyId,
        attachmentHash: dto.attachmentHash,
        validationStatus,
        uploadedBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_RECEIPT_UPLOADED', entityType: 'EXPENSE_RECEIPT', entityId: row.id, action: 'CREATE', userId, newValues: { documentType: dto.documentType, validationStatus } });
    return row;
  }

  list(tenantId: string, claimLineId: string) {
    return this.prisma.expenseReceipt.findMany({ where: { tenantId, claimLineId } });
  }
}
