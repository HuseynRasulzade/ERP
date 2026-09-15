import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

const CONTRACT_REQUIRED_STATUSES = ['APPROVED', 'ACTIVE'];

/**
 * Business rule (user-requested addition, 2026-09-15): a Purchase Order
 * cannot move forward into Goods Receipt / Purchase Invoice until it has
 * a fully drawn-up, APPROVED (or later ACTIVE) Counterparty Contract —
 * "əgər alış sifarişi üzrə müqavilə yaradılmayıbsa, digər sənədlər
 * icra olunmasın, tam müqavilə tərtib olunub təsdiqlənənədək". A DRAFT
 * or PENDING_APPROVAL contract does not satisfy this — the contract
 * itself must have cleared its own approval gate first.
 *
 * Deliberately a read-only check against the same tables
 * `CounterpartyContractService` owns, not a dependency on that service
 * itself — Purchase Execution only needs to ask "is there an approved
 * contract for this PO," never to create/modify a contract.
 */
@Injectable()
export class PurchaseOrderContractGateService {
  constructor(private readonly prisma: PrismaService) {}

  async assertApprovedContractExists(tenantId: string, purchaseOrderId: string) {
    const poLines = await this.prisma.purchaseOrderLine.findMany({ where: { tenantId, purchaseOrderId }, select: { id: true } });
    if (poLines.length === 0) return; // no lines to gate against — let existing line-level validation handle it

    const contractLine = await this.prisma.counterpartyContractLine.findFirst({
      where: {
        tenantId,
        sourceOrderLineId: { in: poLines.map((l) => l.id) },
        contract: { status: { in: CONTRACT_REQUIRED_STATUSES } },
      },
    });

    if (!contractLine) {
      const anyContractAtAll = await this.prisma.counterpartyContractLine.findFirst({
        where: { tenantId, sourceOrderLineId: { in: poLines.map((l) => l.id) } },
      });
      throw new ValidationAppError(
        anyContractAtAll
          ? `Purchase order ${purchaseOrderId} has a contract, but it is not yet APPROVED — approve the contract before creating goods receipts or invoices against this order`
          : `Purchase order ${purchaseOrderId} has no contract yet — create and approve a contract from this order before creating goods receipts or invoices against it`,
      );
    }
  }
}
