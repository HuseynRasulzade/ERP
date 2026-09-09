import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AZ_TAX_TYPE_VAT,
  AZ_TAX_LEGAL_SOURCES,
  AZ_TAX_CATEGORIES,
  AZ_STANDARD_VAT_RATE,
  AZ_ZERO_VAT_RATE,
  AZ_VAT_RULES,
  AZ_VAT_EXEMPTIONS,
} from './az-vat-localization.data';

/**
 * Idempotent Azerbaijan VAT localization seed (spec sections 143-144,
 * 150). Seeded once as shared system rows (tenantId=null) — see the
 * schema-level comment in prisma/schema.prisma for why this differs from
 * Accounting Core's per-tenant chart adoption.
 */
@Injectable()
export class AzTaxLocalizationService {
  private readonly logger = new Logger('AzTaxLocalizationService');

  async ensureSeeded(prisma = this.prismaService) {
    const taxType = await prisma.taxType.upsert({
      where: { code: AZ_TAX_TYPE_VAT },
      create: { code: AZ_TAX_TYPE_VAT, name: 'Value Added Tax' },
      update: {},
    });

    const legalSourceByKey = new Map<string, string>();
    for (const src of AZ_TAX_LEGAL_SOURCES) {
      const existing = await prisma.taxLegalSource.findFirst({ where: { sourceUrl: src.sourceUrl, title: src.title } });
      const row = existing
        ? existing
        : await prisma.taxLegalSource.create({
            data: {
              jurisdiction: src.jurisdiction,
              sourceType: src.sourceType,
              title: src.title,
              sourceUrl: src.sourceUrl,
              sourceVersion: src.sourceVersion,
              status: src.status,
              notes: src.notes,
            },
          });
      legalSourceByKey.set(src.key, row.id);
    }
    const legalSourceId = legalSourceByKey.get('AZ_TAX_CODE');

    for (const cat of AZ_TAX_CATEGORIES) {
      await prisma.taxCategory.upsert({
        where: { code: cat.code },
        create: { code: cat.code, name: cat.name },
        update: { name: cat.name },
      });
    }

    const rateByCode = new Map<string, string>();
    for (const r of [AZ_STANDARD_VAT_RATE, AZ_ZERO_VAT_RATE]) {
      const existing = await prisma.taxRate.findFirst({
        where: { taxTypeId: taxType.id, jurisdiction: 'AZ', code: r.code, effectiveFrom: r.effectiveFrom },
      });
      const row = existing
        ? existing
        : await prisma.taxRate.create({
            data: {
              taxTypeId: taxType.id,
              jurisdiction: 'AZ',
              code: r.code,
              rate: r.rate,
              rateType: r.rateType,
              effectiveFrom: r.effectiveFrom,
              legalSourceId,
              legalArticleReference: r.legalArticleReference,
              status: 'ACTIVE',
              systemDefined: true,
            },
          });
      rateByCode.set(r.code, row.id);
    }

    for (const exemption of AZ_VAT_EXEMPTIONS) {
      await prisma.taxExemption.upsert({
        where: { taxTypeId_code: { taxTypeId: taxType.id, code: exemption.code } },
        create: {
          taxTypeId: taxType.id,
          code: exemption.code,
          name: exemption.name,
          legalSourceId,
          articleReference: exemption.legalArticleReference,
        },
        update: { name: exemption.name },
      });
    }

    for (const rule of AZ_VAT_RULES) {
      const existing = await prisma.taxRule.findFirst({
        where: { tenantId: null, taxTypeId: taxType.id, code: rule.code, effectiveFrom: rule.effectiveFrom },
      });
      if (existing) continue;
      await prisma.taxRule.create({
        data: {
          tenantId: null,
          localizationCode: 'AZ_TAX',
          taxTypeId: taxType.id,
          code: rule.code,
          name: rule.name,
          ruleCategory: rule.ruleCategory,
          effectiveFrom: rule.effectiveFrom,
          status: 'ACTIVE',
          priority: rule.priority,
          legalSourceId,
          legalArticleReference: rule.legalArticleReference,
          treatment: rule.treatment,
          rateId: rule.rateCode ? rateByCode.get(rule.rateCode) : undefined,
          exemptionCode: (rule as any).exemptionCode,
          conditionTaxCategoryCode: rule.conditionTaxCategoryCode,
          systemDefined: true,
        },
      });
    }

    this.logger.log('Seeded AZ_TAX VAT localization (types/rates/categories/rules)');
    return taxType;
  }

  constructor(private readonly prismaService: PrismaService) {}
}
