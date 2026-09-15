import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CashMovementService } from './cash-movement.service';

/**
 * CashDeskService — query surface over the existing Phase 1 `Cashbox`
 * master data (extended for Phase 15, see schema file header). Creating/
 * editing a cash desk stays in Phase 1's own org-structure module; this
 * only adds the balance query spec section 115's `getCashBalance` asks
 * for.
 */
@Injectable()
export class CashDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly movements: CashMovementService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.cashbox.findMany({ where: { organizationId, active: true } });
  }

  async balance(tenantId: string, membershipId: string, organizationId: string, cashDeskId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.movements.getBalancesByCurrency(tenantId, cashDeskId);
  }
}
