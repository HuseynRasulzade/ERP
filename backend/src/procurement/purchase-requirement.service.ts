import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ApprovalService } from '../approvals/approval.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreatePurchaseRequirementDto, RequirementLineItemDto, UpdatePurchaseRequirementDto } from './dto/procurement.dto';

export const PURCHASE_REQUIREMENT_TYPE = 'PURCHASE_REQUIREMENT';
const SEQUENCE_PREFIX = 'PR';

/**
 * PurchaseRequirement service (spec sections 1-11, 105). Demand capture —
 * NO GL, NO posting lifecycle (spec section 94), so this never goes
 * through the document-framework post/unpost machinery SalesOrder and
 * PurchaseOrder use: it is a plain CRUD + status service, closer to
 * CustomerRequest than to SalesOrder. `status` starts OPEN (immediately
 * actionable — spec has no separate submit step) and is recomputed to
 * PARTIALLY_ORDERED/FULLY_ORDERED by ProcurementPlanningService as
 * PurchaseOrders allocate against its lines.
 */
@Injectable()
export class PurchaseRequirementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly approvals: ApprovalService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, status?: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.purchaseRequirement.findMany({
          where: { organizationId, ...(status ? { status } : {}) },
          include: { department: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const req = await this.prisma.purchaseRequirement.findFirst({ where: { id, organizationId }, include: { lines: { orderBy: { position: 'asc' } }, department: true } });
    if (!req) throw new NotFoundAppError('PurchaseRequirement', id);
    return req;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreatePurchaseRequirementDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    const lines = await this.validateLines(tenantId, organizationId, dto.lines);
    await this.ensureSequence(tenantId);

    // Auto-fill (spec: department + creator name come from the logged-in
    // user, never typed manually). An explicit `dto.departmentId` still
    // wins — this only fills the gap when the caller omitted it.
    let departmentId = dto.departmentId;
    if (!departmentId) {
      const ownGrant = await this.access.getOwnGrant(tenantId, membershipId, organizationId);
      departmentId = ownGrant?.departmentId ?? undefined;
    }
    const creator = await this.prisma.user.findUnique({ where: { id: userId } });

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PURCHASE_REQUIREMENT_TYPE, businessDate, tx);

      const header = await tx.purchaseRequirement.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          status: 'OPEN',
          warehouseId: dto.warehouseId,
          departmentId,
          requesterId: dto.requesterId,
          createdByName: creator?.displayName,
          requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : undefined,
          priority: dto.priority ?? 'NORMAL',
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const [index, line] of lines.entries()) {
        await tx.purchaseRequirementLine.create({
          data: {
            tenantId,
            purchaseRequirementId: header.id,
            position: index,
            productId: line.productId,
            unitId: line.unitId,
            quantity: line.quantity,
            requiredByDate: line.requiredByDate,
            warehouseId: line.warehouseId,
            preferredSupplierId: line.preferredSupplierId,
            description: line.description,
            sourceDocumentType: line.sourceDocumentType,
            sourceDocumentId: line.sourceDocumentId,
            sourceLineId: line.sourceLineId,
            createdBy: userId,
            updatedBy: userId,
          },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'PURCHASE_REQUIREMENT_CREATED', entityType: PURCHASE_REQUIREMENT_TYPE, entityId: header.id, action: 'CREATE', userId, newValues: { number: header.number, lineCount: lines.length } },
        tx,
      );

      await this.approvals.createStepsForDocument(tenantId, organizationId, PURCHASE_REQUIREMENT_TYPE, header.id, tx);

      return tx.purchaseRequirement.findFirst({ where: { id: header.id }, include: { lines: { orderBy: { position: 'asc' } }, department: true } });
    });
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: Omit<UpdatePurchaseRequirementDto, 'expectedVersion'>) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status !== 'OPEN' && current.status !== 'DRAFT') {
      throw new ValidationAppError('Only an OPEN requirement with no supplier allocations may be edited');
    }

    let resolvedLines: (RequirementLineItemDto & { productId: string; unitId: string; quantity: Decimal; requiredByDate?: Date })[] | null = null;
    if (patch.lines !== undefined) {
      if (patch.lines.length === 0) throw new ValidationAppError('Requirement must have at least one line');
      resolvedLines = await this.validateLines(tenantId, organizationId, patch.lines);
    }

    const updated = await this.prisma.runInTransaction(async (tx) => {
      const result = await tx.purchaseRequirement.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: {
          ...(patch.documentDate !== undefined ? { documentDate: this.parseDate(patch.documentDate) } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
          ...(patch.requesterId !== undefined ? { requesterId: patch.requesterId } : {}),
          ...(patch.requiredByDate !== undefined ? { requiredByDate: new Date(patch.requiredByDate) } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      if (resolvedLines) {
        await tx.purchaseRequirementLine.deleteMany({ where: { purchaseRequirementId: id } });
        for (const [index, line] of resolvedLines.entries()) {
          await tx.purchaseRequirementLine.create({
            data: {
              tenantId,
              purchaseRequirementId: id,
              position: index,
              productId: line.productId,
              unitId: line.unitId,
              quantity: line.quantity,
              requiredByDate: line.requiredByDate,
              warehouseId: line.warehouseId,
              preferredSupplierId: line.preferredSupplierId,
              description: line.description,
              sourceDocumentType: line.sourceDocumentType,
              sourceDocumentId: line.sourceDocumentId,
              sourceLineId: line.sourceLineId,
              createdBy: userId,
              updatedBy: userId,
            },
          });
        }
      }

      return tx.purchaseRequirement.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } }, department: true } });
    });

    await this.audit.record({ tenantId, eventType: 'PURCHASE_REQUIREMENT_UPDATED', entityType: PURCHASE_REQUIREMENT_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { ...patch, lines: patch.lines?.length } });
    return updated;
  }

  /** Cancels the remaining (not-yet-ordered) quantity of every line and
   * marks the requirement CANCELLED (spec section 99 "Cancel Remainder"). */
  async cancel(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status === 'CANCELLED' || current.status === 'CLOSED') {
      throw new ValidationAppError(`Requirement is already ${current.status}`);
    }

    return this.prisma.runInTransaction(async (tx) => {
      const result = await tx.purchaseRequirement.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: userId, updatedBy: userId, version: { increment: 1 } },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      for (const line of current.lines) {
        const remaining = new Decimal(line.quantity.toString()).minus(line.cancelledQuantity.toString());
        if (remaining.gt(0)) {
          await tx.purchaseRequirementLine.update({ where: { id: line.id }, data: { cancelledQuantity: line.quantity } });
        }
      }

      await this.audit.record({ tenantId, eventType: 'PURCHASE_REQUIREMENT_CANCELLED', entityType: PURCHASE_REQUIREMENT_TYPE, entityId: id, action: 'CANCEL', userId }, tx);
      return tx.purchaseRequirement.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } }, department: true } });
    });
  }

  // -- Approval -----------------------------------------------------------------

  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id); // 404s if not found/not in this org
    await this.approvals.approve(tenantId, organizationId, PURCHASE_REQUIREMENT_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.reject(tenantId, organizationId, PURCHASE_REQUIREMENT_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  // -- helpers ----------------------------------------------------------------

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async validateLines(tenantId: string, organizationId: string, lines: RequirementLineItemDto[]) {
    const resolved = [];
    for (const line of lines) {
      const quantity = new Decimal(line.quantity.toString());
      if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationAppError('Line quantity must be positive');

      const product = await this.prisma.product.findFirst({ where: { id: line.productId, organizationId } });
      if (!product || !product.active) throw new ValidationAppError('Product does not belong to this organization or is inactive');

      const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id: line.unitId, tenantId } });
      if (!unit) throw new ValidationAppError('Unit of measure not found');

      if (line.preferredSupplierId) {
        const supplier = await this.prisma.counterparty.findFirst({ where: { id: line.preferredSupplierId, organizationId } });
        if (!supplier) throw new ValidationAppError('Preferred supplier does not belong to this organization');
      }

      resolved.push({
        ...line,
        quantity,
        requiredByDate: line.requiredByDate ? new Date(line.requiredByDate) : undefined,
      });
    }
    return resolved;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PURCHASE_REQUIREMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PURCHASE_REQUIREMENT_TYPE, documentType: PURCHASE_REQUIREMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
