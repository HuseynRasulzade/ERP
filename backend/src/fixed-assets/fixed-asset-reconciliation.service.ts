import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FIXED_ASSET_MOVEMENT_REGISTER } from './fixed-asset-balance.service';

export interface ReconciliationResult {
  label: string;
  subledgerBalance: string;
  glBalance: string;
  difference: string;
  healthy: boolean;
}

const TOLERANCE = new Decimal('0.01');

/**
 * FixedAssetReconciliationService (docx spec Phase 16 sections 124-125) —
 * FA Subledger (the RegisterMovement-derived org-wide totals) vs FA GL
 * Accounts, the same book-vs-GL principle CashHealthService already uses
 * per cash desk, here aggregated per organization across every asset/CIP
 * project. A future Phase 30 health engine subsumes this (spec section
 * 124); this build covers the three accounts the spec explicitly calls
 * out (Gross Cost, Accumulated Depreciation, CIP).
 */
@Injectable()
export class FixedAssetReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
  ) {}

  async reconcileAll(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ): Promise<ReconciliationResult[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const now = new Date();
    return Promise.all([
      this.reconcileCostAccounts(tenantId, organizationId, now),
      this.reconcileAccumulatedDepreciation(tenantId, organizationId, now),
      this.reconcileCIP(tenantId, organizationId, now),
    ]);
  }

  private async reconcileCostAccounts(
    tenantId: string,
    organizationId: string,
    asOfDate: Date,
  ): Promise<ReconciliationResult> {
    const movements = await this.orgMovements(
      tenantId,
      organizationId,
      'assetId',
    );
    const subledger = movements.reduce(
      (sum, r) => sum.plus(r.costIncrease ?? '0').minus(r.costDecrease ?? '0'),
      new Decimal(0),
    );
    const gl = await this.glBalance(
      tenantId,
      organizationId,
      MappingKeys.FIXED_ASSET_COST,
      asOfDate,
      'DEBIT',
    );
    return this.buildResult('Fixed Asset Gross Cost', subledger, gl);
  }

  private async reconcileAccumulatedDepreciation(
    tenantId: string,
    organizationId: string,
    asOfDate: Date,
  ): Promise<ReconciliationResult> {
    const movements = await this.orgMovements(
      tenantId,
      organizationId,
      'assetId',
    );
    const subledger = movements.reduce(
      (sum, r) =>
        sum
          .plus(r.depreciationIncrease ?? '0')
          .minus(r.depreciationDecrease ?? '0')
          .plus(r.impairmentIncrease ?? '0')
          .minus(r.impairmentDecrease ?? '0'),
      new Decimal(0),
    );
    const gl = await this.glBalance(
      tenantId,
      organizationId,
      MappingKeys.ACCUMULATED_DEPRECIATION,
      asOfDate,
      'CREDIT',
    );
    return this.buildResult(
      'Accumulated Depreciation + Impairment',
      subledger,
      gl,
    );
  }

  private async reconcileCIP(
    tenantId: string,
    organizationId: string,
    asOfDate: Date,
  ): Promise<ReconciliationResult> {
    const movements = await this.orgMovements(
      tenantId,
      organizationId,
      'cipProjectId',
    );
    const subledger = movements.reduce(
      (sum, r) => sum.plus(r.costIncrease ?? '0').minus(r.costDecrease ?? '0'),
      new Decimal(0),
    );
    const gl = await this.glBalance(
      tenantId,
      organizationId,
      MappingKeys.FIXED_ASSET_CIP,
      asOfDate,
      'DEBIT',
    );
    return this.buildResult(
      'CIP (Capital Investment in Progress)',
      subledger,
      gl,
    );
  }

  private async orgMovements(
    tenantId: string,
    organizationId: string,
    dimensionKey: 'assetId' | 'cipProjectId',
  ) {
    const rows = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        dimensions: { path: ['organizationId'], equals: organizationId },
      },
    });
    return rows
      .filter((r) => {
        const d = r.dimensions as Record<string, unknown> | null;
        return d && d[dimensionKey] !== undefined && d[dimensionKey] !== null;
      })
      .map((r) => (r.resources as Record<string, string | undefined>) ?? {});
  }

  private async glBalance(
    tenantId: string,
    organizationId: string,
    mappingKey: string,
    asOfDate: Date,
    normalSide: 'DEBIT' | 'CREDIT',
  ): Promise<Decimal> {
    let account;
    try {
      account = await this.mappings.resolve(
        tenantId,
        organizationId,
        mappingKey,
        asOfDate,
      );
    } catch {
      return new Decimal(0);
    }
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        accountId: account.id,
        journalEntry: { tenantId, organizationId, status: 'POSTED' },
      },
    });
    return lines.reduce((sum, l) => {
      const amount = new Decimal(l.amountBase.toString());
      const signed = l.side === normalSide ? amount : amount.neg();
      return sum.plus(signed);
    }, new Decimal(0));
  }

  private buildResult(
    label: string,
    subledgerBalance: Decimal,
    glBalance: Decimal,
  ): ReconciliationResult {
    const difference = subledgerBalance.minus(glBalance);
    return {
      label,
      subledgerBalance: subledgerBalance.toFixed(2),
      glBalance: glBalance.toFixed(2),
      difference: difference.toFixed(2),
      healthy: difference.abs().lte(TOLERANCE),
    };
  }
}
