import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import {
  AZ_SECTIONS,
  AZ_GROUPS,
  AZ_ACCOUNTS,
  AZ_DEFAULT_DIMENSION_RULES,
  AZ_DEFAULT_MAPPINGS,
  groupCodeFor,
} from './az-standard-coa.data';
import { DimensionCodes, DIMENSION_REFERENCE_ENTITY_TYPE, MappingKeys } from './accounting-dimension-codes';

const AZ_TEMPLATE_CODE = 'AZ_STANDARD';
const TEMPLATE_VERSION = '1.0';

/**
 * System Chart Template -> per-tenant adopted chart (spec sections 6-7).
 *
 * `AZ_STANDARD_COA` sections/groups/dimension-definitions are seeded once
 * as SHARED rows (tenantId=null, same precedent as ExchangeRate's
 * system-level rows elsewhere in this schema) — they're read-only
 * classification metadata, not tenant data. Each tenant that needs to post
 * gets its OWN `ChartOfAccounts` + `Account` rows cloned from the template
 * (`ensureAdopted`), so a tenant can add subaccounts/custom accounts
 * without ever touching — or being touched by upgrades to — the template.
 */
@Injectable()
export class ChartOfAccountsService {
  private readonly logger = new Logger('ChartOfAccountsService');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent (spec section 150): safe to call on every app boot / every
   * tenant onboarding. Seeds the shared system template once, then ensures
   * this tenant has its own adopted chart cloned from it. Running twice
   * never duplicates sections/groups/accounts/dimensions/mappings.
   */
  async ensureAdopted(tenantId: string) {
    const template = await this.seedSystemTemplate();
    const existing = await this.prisma.chartOfAccounts.findUnique({
      where: { tenantId_code: { tenantId, code: AZ_TEMPLATE_CODE } },
    });
    if (existing) return existing;

    return this.prisma.runInTransaction(async (tx) => {
      const tenantChart = await tx.chartOfAccounts.create({
        data: {
          tenantId,
          code: AZ_TEMPLATE_CODE,
          name: template.name,
          countryCode: template.countryCode,
          localizationCode: template.localizationCode,
          versionCode: template.versionCode,
          systemTemplate: false,
        },
      });

      const templateAccounts = await tx.account.findMany({ where: { chartOfAccountsId: template.id } });
      const codeToTenantId = new Map<string, string>();

      // Two passes: create every account first (parentless), then patch in
      // parentAccountId once every code->id mapping for this tenant exists
      // — subaccounts like 414-1 reference a parent seeded in the same run.
      for (const src of templateAccounts) {
        const created = await tx.account.create({
          data: {
            tenantId,
            chartOfAccountsId: tenantChart.id,
            financialStatementSectionId: src.financialStatementSectionId,
            financialStatementGroupId: src.financialStatementGroupId,
            code: src.code,
            name: src.name,
            accountClass: src.accountClass,
            normalBalance: src.normalBalance,
            postingAllowed: src.postingAllowed,
            currencyTracking: src.currencyTracking,
            quantityTracking: src.quantityTracking,
            systemAccount: true,
            customizable: true,
            sourceTemplate: 'AZ_STANDARD_COA',
            templateVersion: TEMPLATE_VERSION,
            systemSeed: true,
          },
        });
        codeToTenantId.set(src.code, created.id);
      }

      for (const src of templateAccounts) {
        if (!src.parentAccountId) continue;
        const parentSrc = templateAccounts.find((a) => a.id === src.parentAccountId);
        if (!parentSrc) continue;
        const childId = codeToTenantId.get(src.code);
        const parentId = codeToTenantId.get(parentSrc.code);
        if (!childId || !parentId) continue;
        await tx.account.update({ where: { id: childId }, data: { parentAccountId: parentId } });
      }

      // Clone default dimension rules onto the tenant's own accounts.
      const dimensionDefs = await tx.accountingDimensionDefinition.findMany({ where: { tenantId: null } });
      const dimByCode = new Map(dimensionDefs.map((d) => [d.code, d.id]));
      for (const [accountCode, dimensionCodes] of Object.entries(AZ_DEFAULT_DIMENSION_RULES)) {
        const accountId = codeToTenantId.get(accountCode);
        if (!accountId) continue;
        for (const [i, dimCode] of dimensionCodes.entries()) {
          const dimensionDefinitionId = dimByCode.get(dimCode);
          if (!dimensionDefinitionId) continue;
          await tx.accountDimensionRule.create({
            // validFrom deliberately backdated to the epoch rather than
            // left at its `now()` default: these are the chart's baseline
            // rules and must cover every historical business date a
            // freshly-adopting tenant might post against, not just dates
            // after the moment adoption happened to run.
            data: { accountId, dimensionDefinitionId, required: true, sequence: i, validFrom: new Date(0) },
          });
        }
      }

      // Clone default mappings for the tenant (organizationId=null = tenant-wide default).
      for (const [mappingKey, accountCode] of Object.entries(AZ_DEFAULT_MAPPINGS)) {
        const accountId = codeToTenantId.get(accountCode);
        if (!accountId) continue;
        await tx.accountingMapping.create({
          // Same backdating rationale as the dimension rules above.
          data: { tenantId, mappingKey, accountId, validFrom: new Date(0) },
        });
      }

      this.logger.log(`Adopted AZ_STANDARD chart of accounts for tenant ${tenantId}`);
      return tenantChart;
    });
  }

  async getTenantChart(tenantId: string) {
    const chart = await this.prisma.chartOfAccounts.findUnique({
      where: { tenantId_code: { tenantId, code: AZ_TEMPLATE_CODE } },
    });
    if (!chart) throw new NotFoundAppError('ChartOfAccounts', AZ_TEMPLATE_CODE);
    return chart;
  }

  /** Seeds the shared system template (tenantId=null) exactly once. */
  private async seedSystemTemplate() {
    const existing = await this.prisma.chartOfAccounts.findFirst({
      where: { tenantId: null, code: AZ_TEMPLATE_CODE, systemTemplate: true },
    });
    if (existing) return existing;

    return this.prisma.runInTransaction(async (tx) => {
      // Re-check inside the transaction to stay idempotent under concurrent
      // first-boot calls (two requests racing to seed simultaneously).
      const raced = await tx.chartOfAccounts.findFirst({
        where: { tenantId: null, code: AZ_TEMPLATE_CODE, systemTemplate: true },
      });
      if (raced) return raced;

      const template = await tx.chartOfAccounts.create({
        data: {
          tenantId: null,
          code: AZ_TEMPLATE_CODE,
          name: 'Azərbaycan standart hesablar planı',
          countryCode: 'AZ',
          localizationCode: 'AZ_STANDARD_COA',
          versionCode: TEMPLATE_VERSION,
          systemTemplate: true,
        },
      });

      const sectionIdByCode = new Map<string, string>();
      for (const s of AZ_SECTIONS) {
        const row = await tx.financialStatementSection.create({
          data: {
            chartOfAccountsId: template.id,
            code: s.code,
            name: s.name,
            sequence: s.sequence,
            statementType: s.statementType,
          },
        });
        sectionIdByCode.set(s.code, row.id);
      }

      const groupIdByCode = new Map<string, string>();
      for (const g of AZ_GROUPS) {
        const sectionId = sectionIdByCode.get(g.sectionCode);
        if (!sectionId) throw new Error(`Unknown section ${g.sectionCode} for group ${g.code}`);
        const row = await tx.financialStatementGroup.create({
          data: { sectionId, code: g.code, name: g.name, sequence: g.sequence },
        });
        groupIdByCode.set(g.code, row.id);
      }

      const accountIdByCode = new Map<string, string>();
      for (const acc of AZ_ACCOUNTS) {
        const groupCode = groupCodeFor(acc.code);
        const groupId = groupIdByCode.get(groupCode);
        const group = AZ_GROUPS.find((g) => g.code === groupCode);
        const sectionId = group ? sectionIdByCode.get(group.sectionCode) : undefined;
        const isSubaccount = acc.code.includes('-');
        const normalBalance = defaultNormalBalance(acc.accountClass);
        const row = await tx.account.create({
          data: {
            tenantId: null,
            chartOfAccountsId: template.id,
            financialStatementSectionId: isSubaccount ? undefined : sectionId,
            financialStatementGroupId: isSubaccount ? undefined : groupId,
            code: acc.code,
            name: acc.name,
            accountClass: acc.accountClass,
            normalBalance,
            postingAllowed: acc.postingAllowed ?? true,
            currencyTracking: acc.currencyTracking ?? false,
            quantityTracking: acc.quantityTracking ?? false,
            systemAccount: true,
            customizable: false,
            sourceTemplate: 'AZ_STANDARD_COA',
            templateVersion: TEMPLATE_VERSION,
            systemSeed: true,
          },
        });
        accountIdByCode.set(acc.code, row.id);
      }
      for (const acc of AZ_ACCOUNTS) {
        if (!acc.parentCode) continue;
        const childId = accountIdByCode.get(acc.code);
        const parentId = accountIdByCode.get(acc.parentCode);
        if (!childId || !parentId) continue;
        await tx.account.update({ where: { id: childId }, data: { parentAccountId: parentId } });
      }

      // Groups themselves (10, 20, 30 ...) are pure reporting nodes: never
      // postable (spec section 260 "posting_allowed = false").
      // They are not modeled as Account rows at all in this implementation
      // (Account rows exist only for the leaf/posting-eligible codes above
      // plus non-postable placeholders like 341/411/414/501/515/801 that
      // the spec explicitly lists as structural parents) — see
      // docs/ACCOUNTING_CORE.md for the documented simplification.

      const dimensionSeeds = Object.values(DimensionCodes).map((code) => ({
        code,
        name: code.replace(/_/g, ' '),
        referenceEntityType: DIMENSION_REFERENCE_ENTITY_TYPE[code] ?? code,
      }));
      for (const d of dimensionSeeds) {
        await tx.accountingDimensionDefinition.create({
          data: {
            tenantId: null,
            code: d.code,
            name: d.name,
            valueType: 'REFERENCE',
            referenceEntityType: d.referenceEntityType,
            systemDefined: true,
          },
        });
      }

      this.logger.log('Seeded AZ_STANDARD_COA system template');
      return template;
    });
  }
}

function defaultNormalBalance(accountClass: string): 'DEBIT' | 'CREDIT' | 'BOTH' {
  switch (accountClass) {
    case 'ASSET':
    case 'CONTRA_LIABILITY':
    case 'CONTRA_EQUITY':
    case 'CONTRA_REVENUE':
    case 'EXPENSE':
    case 'TAX_EXPENSE':
      return 'DEBIT';
    case 'CONTRA_ASSET':
    case 'LIABILITY':
    case 'EQUITY':
    case 'REVENUE':
      return 'CREDIT';
    case 'PROFIT_LOSS':
    case 'OFF_BALANCE':
    default:
      return 'BOTH';
  }
}

export { AZ_TEMPLATE_CODE, MappingKeys };
