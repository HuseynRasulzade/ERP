import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
      // IDs generated up front (rather than one create() round-trip per
      // row) so every insert below can be a single batched `createMany` —
      // this clone is 300+ rows, and a remote/managed Postgres connection
      // (real network latency per statement, not the near-zero latency of
      // a local dev DB) previously blew the interactive-transaction
      // timeout doing this as one `create()` per row. Parent linkage is
      // resolved from this map before the insert, so no second pass is
      // needed either.
      for (const src of templateAccounts) codeToTenantId.set(src.code, randomUUID());

      await tx.account.createMany({
        data: templateAccounts.map((src) => ({
          id: codeToTenantId.get(src.code)!,
          tenantId,
          chartOfAccountsId: tenantChart.id,
          parentAccountId: src.parentAccountId
            ? (codeToTenantId.get(templateAccounts.find((a) => a.id === src.parentAccountId)?.code ?? '') ?? null)
            : null,
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
        })),
      });

      // Clone default dimension rules onto the tenant's own accounts.
      const dimensionDefs = await tx.accountingDimensionDefinition.findMany({ where: { tenantId: null } });
      const dimByCode = new Map(dimensionDefs.map((d) => [d.code, d.id]));
      const dimensionRuleRows: { accountId: string; dimensionDefinitionId: string; required: boolean; sequence: number; validFrom: Date }[] = [];
      for (const [accountCode, dimensionCodes] of Object.entries(AZ_DEFAULT_DIMENSION_RULES)) {
        const accountId = codeToTenantId.get(accountCode);
        if (!accountId) continue;
        for (const [i, dimCode] of dimensionCodes.entries()) {
          const dimensionDefinitionId = dimByCode.get(dimCode);
          if (!dimensionDefinitionId) continue;
          // validFrom deliberately backdated to the epoch rather than left
          // at its `now()` default: these are the chart's baseline rules
          // and must cover every historical business date a freshly-
          // adopting tenant might post against, not just dates after the
          // moment adoption happened to run.
          dimensionRuleRows.push({ accountId, dimensionDefinitionId, required: true, sequence: i, validFrom: new Date(0) });
        }
      }
      if (dimensionRuleRows.length > 0) await tx.accountDimensionRule.createMany({ data: dimensionRuleRows });

      // Clone default mappings for the tenant (organizationId=null = tenant-wide default).
      const mappingRows: { tenantId: string; mappingKey: string; accountId: string; validFrom: Date }[] = [];
      for (const [mappingKey, accountCode] of Object.entries(AZ_DEFAULT_MAPPINGS)) {
        const accountId = codeToTenantId.get(accountCode);
        if (!accountId) continue;
        // Same backdating rationale as the dimension rules above.
        mappingRows.push({ tenantId, mappingKey, accountId, validFrom: new Date(0) });
      }
      if (mappingRows.length > 0) await tx.accountingMapping.createMany({ data: mappingRows });

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

      // Every row's id is generated up front so sections/groups/accounts
      // can each be inserted in ONE batched `createMany` instead of one
      // `create()` round-trip per row (~300+ rows total) — see the same
      // rationale in `ensureAdopted` above; this matters even more here
      // since the system template is seeded exactly once, on whichever
      // request happens to be first, and must not time out on a
      // higher-latency (e.g. managed/remote) database connection.
      const sectionIdByCode = new Map(AZ_SECTIONS.map((s) => [s.code, randomUUID()]));
      await tx.financialStatementSection.createMany({
        data: AZ_SECTIONS.map((s) => ({
          id: sectionIdByCode.get(s.code)!,
          chartOfAccountsId: template.id,
          code: s.code,
          name: s.name,
          sequence: s.sequence,
          statementType: s.statementType,
        })),
      });

      const groupIdByCode = new Map(AZ_GROUPS.map((g) => [g.code, randomUUID()]));
      await tx.financialStatementGroup.createMany({
        data: AZ_GROUPS.map((g) => {
          const sectionId = sectionIdByCode.get(g.sectionCode);
          if (!sectionId) throw new Error(`Unknown section ${g.sectionCode} for group ${g.code}`);
          return { id: groupIdByCode.get(g.code)!, sectionId, code: g.code, name: g.name, sequence: g.sequence };
        }),
      });

      const accountIdByCode = new Map(AZ_ACCOUNTS.map((a) => [a.code, randomUUID()]));
      await tx.account.createMany({
        data: AZ_ACCOUNTS.map((acc) => {
          const groupCode = groupCodeFor(acc.code);
          const groupId = groupIdByCode.get(groupCode);
          const group = AZ_GROUPS.find((g) => g.code === groupCode);
          const sectionId = group ? sectionIdByCode.get(group.sectionCode) : undefined;
          const isSubaccount = acc.code.includes('-');
          const normalBalance = defaultNormalBalance(acc.accountClass);
          return {
            id: accountIdByCode.get(acc.code)!,
            tenantId: null,
            chartOfAccountsId: template.id,
            parentAccountId: acc.parentCode ? (accountIdByCode.get(acc.parentCode) ?? null) : null,
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
          };
        }),
      });

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
      await tx.accountingDimensionDefinition.createMany({
        data: dimensionSeeds.map((d) => ({
          tenantId: null,
          code: d.code,
          name: d.name,
          valueType: 'REFERENCE',
          referenceEntityType: d.referenceEntityType,
          systemDefined: true,
        })),
      });

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
