import { Body, Controller, Param, Post } from '@nestjs/common';
import { TaxCalculationService } from './tax-calculation.service';
import { CalculateTaxDto } from './dto/tax-engine.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * Tax preview (spec section 35): calculates and explains WITHOUT creating
 * any TaxMovement or accounting consequence — safe to call from a Sales
 * document draft before the user commits to saving/posting.
 */
@Controller('organizations/:organizationId/tax')
export class TaxCalculationController {
  constructor(
    private readonly calculation: TaxCalculationService,
    private readonly access: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.TAX_CALCULATION_VIEW)
  @Post('calculate')
  async calculate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: CalculateTaxDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const taxPointDate = parseDate(dto.taxPointDate);
    const result = await this.calculation.calculateLine(
      {
        tenantId,
        organizationId,
        businessDate: taxPointDate,
        taxPointDate,
        operationType: dto.operationType,
        taxCategoryCode: dto.taxCategoryCode,
        taxpayerSide: dto.taxpayerSide,
      },
      {
        sourceLineId: dto.sourceLineId,
        amount: dto.amount,
        priceIncludesTax: dto.priceIncludesTax,
        currency: dto.currency,
        recoverablePercent: dto.recoverablePercent,
      },
    );
    return serializeResult(result);
  }
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}

function serializeResult(result: any) {
  return {
    ...result,
    rate: result.rate.toString(),
    taxableBase: result.taxableBase.toString(),
    taxAmount: result.taxAmount.toString(),
    recoverableAmount: result.recoverableAmount.toString(),
    nonrecoverableAmount: result.nonrecoverableAmount.toString(),
    grossAmount: result.grossAmount.toString(),
    roundingAdjustment: result.roundingAdjustment.toString(),
  };
}
