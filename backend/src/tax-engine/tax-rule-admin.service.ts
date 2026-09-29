import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateTaxRuleDto, RepealTaxRuleDto, UpdateTaxRuleDto } from './dto/tax-engine.dto';

/**
 * Tenant-specific custom TaxRule administration (spec sections 6-9, 74,
 * 97) — the piece `docs/TAX_ENGINE.md`'s own Technical Debt flagged as
 * missing: "no endpoint to create/edit/approve/activate a custom
 * TaxRule". Every method here operates ONLY on rows this tenant itself
 * created (`tenantId` set to the caller's own tenant) — the shared,
 * system-seeded rules (`tenantId: null`, e.g. `AZ_VAT_STANDARD_RULE`) are
 * never touched by this service, matching the spec's own "never a
 * destructive update to an existing rule" rule.
 *
 * Workflow (spec section 74: "legal source detected -> proposed rule ->
 * human/legal review -> activation"): DRAFT -> REVIEWED -> APPROVED ->
 * ACTIVE -> REPEALED. A rule can only be edited in place while still
 * DRAFT or REVIEWED; once APPROVED/ACTIVE, correcting it means creating a
 * brand-new rule row (with its own later `effectiveFrom`) and repealing
 * the old one — the same "new law-effective period is a new row" rule
 * every other rule in this table already follows.
 */
@Injectable()
export class TaxRuleAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.taxRule.findMany({ where: { tenantId }, include: { rate: true, legalSource: true }, orderBy: [{ effectiveFrom: 'desc' }] });
  }

  async get(tenantId: string, id: string) {
    const rule = await this.prisma.taxRule.findFirst({ where: { id, tenantId }, include: { rate: true, legalSource: true, taxType: true } });
    if (!rule) throw new NotFoundAppError('TaxRule', id);
    return rule;
  }

  async create(tenantId: string, userId: string, dto: CreateTaxRuleDto) {
    const taxType = await this.prisma.taxType.findUnique({ where: { code: dto.taxTypeCode } });
    if (!taxType) throw new ValidationAppError(`Unknown tax type code: ${dto.taxTypeCode}`);
    if (dto.rateId) await this.assertRateExists(dto.rateId);
    if (dto.legalSourceId) await this.assertLegalSourceExists(dto.legalSourceId);
    this.assertDateOrder(dto.effectiveFrom, dto.effectiveTo);

    const created = await this.prisma.taxRule.create({
      data: {
        tenantId,
        taxTypeId: taxType.id,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        ruleCategory: dto.ruleCategory,
        treatment: dto.treatment as never,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        priority: dto.priority ?? 0,
        rateId: dto.rateId,
        legalSourceId: dto.legalSourceId,
        legalArticleReference: dto.legalArticleReference,
        legalSubarticleReference: dto.legalSubarticleReference,
        exemptionCode: dto.exemptionCode,
        conditionOperationType: dto.conditionOperationType,
        conditionTaxCategoryCode: dto.conditionTaxCategoryCode,
        conditionTaxpayerSide: dto.conditionTaxpayerSide,
        systemDefined: false,
        status: 'DRAFT',
        createdBy: userId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TAX_RULE_CREATED',
      entityType: 'TaxRule',
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { code: created.code, ruleCategory: created.ruleCategory, treatment: created.treatment, status: created.status },
    });
    return created;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateTaxRuleDto) {
    const rule = await this.getOwned(tenantId, id);
    if (rule.status !== 'DRAFT' && rule.status !== 'REVIEWED') {
      throw new ValidationAppError(`Cannot edit a tax rule in status ${rule.status} — create a new rule (with a later effectiveFrom) and repeal this one instead`);
    }
    if (dto.rateId) await this.assertRateExists(dto.rateId);
    if (dto.legalSourceId) await this.assertLegalSourceExists(dto.legalSourceId);
    this.assertDateOrder(dto.effectiveFrom ?? rule.effectiveFrom.toISOString(), dto.effectiveTo ?? rule.effectiveTo?.toISOString());

    const updated = await this.prisma.taxRule.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        treatment: dto.treatment as never,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        priority: dto.priority,
        rateId: dto.rateId,
        legalSourceId: dto.legalSourceId,
        legalArticleReference: dto.legalArticleReference,
        exemptionCode: dto.exemptionCode,
        conditionOperationType: dto.conditionOperationType,
        conditionTaxCategoryCode: dto.conditionTaxCategoryCode,
        conditionTaxpayerSide: dto.conditionTaxpayerSide,
        version: { increment: 1 },
      },
    });

    await this.audit.record({ tenantId, eventType: 'TAX_RULE_EDITED', entityType: 'TaxRule', entityId: id, action: 'UPDATE', userId, oldValues: { treatment: rule.treatment }, newValues: { treatment: updated.treatment } });
    return updated;
  }

  async submitForReview(tenantId: string, userId: string, id: string) {
    const rule = await this.getOwned(tenantId, id);
    if (rule.status !== 'DRAFT') throw new ValidationAppError(`Only a DRAFT rule can be submitted for review (current status: ${rule.status})`);
    const updated = await this.prisma.taxRule.update({ where: { id }, data: { status: 'REVIEWED' } });
    await this.audit.record({ tenantId, eventType: 'TAX_RULE_SUBMITTED_FOR_REVIEW', entityType: 'TaxRule', entityId: id, action: 'UPDATE', userId });
    return updated;
  }

  async approve(tenantId: string, userId: string, id: string) {
    const rule = await this.getOwned(tenantId, id);
    if (rule.status !== 'REVIEWED') throw new ValidationAppError(`Only a REVIEWED rule can be approved (current status: ${rule.status})`);
    const updated = await this.prisma.taxRule.update({ where: { id }, data: { status: 'APPROVED' } });
    await this.audit.record({ tenantId, eventType: 'TAX_RULE_APPROVED', entityType: 'TaxRule', entityId: id, action: 'UPDATE', userId });
    return updated;
  }

  /** Activates the rule — from this point `TaxRuleResolverService.resolve`
   * can select it. Does not automatically supersede any other rule: a
   * genuine overlap (same tenant/date/category/operation/priority) is
   * caught at RESOLVE time by the resolver's own existing ambiguity
   * check, never silently by this method. */
  async activate(tenantId: string, userId: string, id: string) {
    const rule = await this.getOwned(tenantId, id);
    if (rule.status !== 'APPROVED') throw new ValidationAppError(`Only an APPROVED rule can be activated (current status: ${rule.status})`);
    const updated = await this.prisma.taxRule.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.record({ tenantId, eventType: 'TAX_RULE_ACTIVATED', entityType: 'TaxRule', entityId: id, action: 'UPDATE', userId, newValues: { effectiveFrom: rule.effectiveFrom } });
    return updated;
  }

  /** Repeals an ACTIVE rule — sets `effectiveTo`, never deletes and never
   * touches `effectiveFrom` or any date already elapsed (spec section
   * 8's "never destructively edited"). */
  async repeal(tenantId: string, userId: string, id: string, dto: RepealTaxRuleDto) {
    const rule = await this.getOwned(tenantId, id);
    if (rule.status !== 'ACTIVE') throw new ValidationAppError(`Only an ACTIVE rule can be repealed (current status: ${rule.status})`);
    const effectiveTo = new Date(dto.effectiveTo);
    if (effectiveTo < rule.effectiveFrom) throw new ValidationAppError('Repeal date cannot be before the rule took effect');

    const updated = await this.prisma.taxRule.update({ where: { id }, data: { status: 'REPEALED', effectiveTo } });
    await this.audit.record({ tenantId, eventType: 'TAX_RULE_REPEALED', entityType: 'TaxRule', entityId: id, action: 'UPDATE', userId, reason: dto.reason, newValues: { effectiveTo } });
    return updated;
  }

  private async getOwned(tenantId: string, id: string) {
    const rule = await this.prisma.taxRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundAppError('TaxRule', id);
    return rule;
  }

  private async assertRateExists(rateId: string) {
    const rate = await this.prisma.taxRate.findUnique({ where: { id: rateId } });
    if (!rate) throw new ValidationAppError(`Unknown tax rate id: ${rateId}`);
  }

  private async assertLegalSourceExists(legalSourceId: string) {
    const source = await this.prisma.taxLegalSource.findUnique({ where: { id: legalSourceId } });
    if (!source) throw new ValidationAppError(`Unknown tax legal source id: ${legalSourceId}`);
  }

  private assertDateOrder(effectiveFrom: string, effectiveTo?: string | null) {
    if (effectiveTo && new Date(effectiveTo) < new Date(effectiveFrom)) {
      throw new ValidationAppError('effectiveTo cannot be before effectiveFrom');
    }
  }
}
