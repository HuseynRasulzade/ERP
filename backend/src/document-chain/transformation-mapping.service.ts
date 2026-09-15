import { Injectable } from '@nestjs/common';
import { ValidationAppError } from '../common/errors/app-error';

export type HeaderMappingType = 'COPY' | 'CONSTANT' | 'DEFAULT_SERVICE' | 'DERIVED_RULE' | 'LOOKUP' | 'USER_REQUIRED' | 'DO_NOT_COPY';

export interface HeaderMappingRule {
  targetField: string;
  mappingType: HeaderMappingType;
  sourceField?: string; // COPY
  constant?: unknown; // CONSTANT
  defaultKey?: string; // DEFAULT_SERVICE — a key into `defaults` supplied by the caller
  derivedFrom?: string[]; // DERIVED_RULE — source fields consulted, first non-null wins (a safe, tiny "coalesce" rule — no arbitrary formulas)
  lookupTable?: Record<string, unknown>; // LOOKUP — keyed by the value of `sourceField`
}

export interface LineMappingRule {
  sourceLineType: string;
  targetLineType: string;
  quantityMapping?: 'COPY' | 'CONSTANT' | 'ZERO';
  quantityConstant?: number;
  amountMapping?: 'COPY' | 'DERIVE_FROM_QUANTITY' | 'ZERO';
  splitPolicy?: 'NONE' | 'ALLOW_PARTIAL';
  groupingPolicy?: 'ONE_TO_ONE' | 'MANY_TO_ONE';
}

export interface MappingContext {
  defaults?: Record<string, unknown>;
  userSuppliedFields?: Record<string, unknown>;
}

/**
 * TransformationMappingService (docx spec Phase 27, sections 33-40).
 * A small, closed set of mapping primitives — deliberately NOT a
 * scripting/eval engine (the same "no arbitrary formulas" discipline
 * established by `WorkflowConditionService` in Phase 26 and
 * `FinancialReportFormulaService` in Phase 23). `DERIVED_RULE` here is
 * intentionally limited to a coalesce over named source fields, never a
 * general expression — a genuinely computed derivation belongs in a
 * `DEFAULT_SERVICE` key the calling business module resolves itself.
 */
@Injectable()
export class TransformationMappingService {
  validateHeaderMapping(rules: HeaderMappingRule[]): void {
    if (!Array.isArray(rules)) throw new ValidationAppError('headerMapping must be an array');
    for (const rule of rules) {
      if (!rule.targetField) throw new ValidationAppError('Every header mapping rule needs a targetField');
      switch (rule.mappingType) {
        case 'COPY':
          if (!rule.sourceField) throw new ValidationAppError(`COPY mapping for ${rule.targetField} needs sourceField`);
          break;
        case 'CONSTANT':
          if (rule.constant === undefined) throw new ValidationAppError(`CONSTANT mapping for ${rule.targetField} needs a constant value`);
          break;
        case 'DEFAULT_SERVICE':
          if (!rule.defaultKey) throw new ValidationAppError(`DEFAULT_SERVICE mapping for ${rule.targetField} needs defaultKey`);
          break;
        case 'DERIVED_RULE':
          if (!rule.derivedFrom || rule.derivedFrom.length === 0) throw new ValidationAppError(`DERIVED_RULE mapping for ${rule.targetField} needs derivedFrom`);
          break;
        case 'LOOKUP':
          if (!rule.sourceField || !rule.lookupTable) throw new ValidationAppError(`LOOKUP mapping for ${rule.targetField} needs sourceField and lookupTable`);
          break;
        case 'USER_REQUIRED':
        case 'DO_NOT_COPY':
          break;
        default:
          throw new ValidationAppError(`Unknown header mapping type: ${rule.mappingType as string}`);
      }
    }
  }

  /** Applies header mapping rules against one source snapshot object. A
   * `USER_REQUIRED` field missing from `context.userSuppliedFields`
   * throws rather than silently defaulting (spec section 36's own "never
   * guess a required business decision"). */
  applyHeaderMapping(rules: HeaderMappingRule[], source: Record<string, unknown>, context: MappingContext = {}): Record<string, unknown> {
    const target: Record<string, unknown> = {};
    for (const rule of rules) {
      switch (rule.mappingType) {
        case 'DO_NOT_COPY':
          continue;
        case 'COPY':
          target[rule.targetField] = source[rule.sourceField!];
          break;
        case 'CONSTANT':
          target[rule.targetField] = rule.constant;
          break;
        case 'DEFAULT_SERVICE': {
          const value = context.defaults?.[rule.defaultKey!];
          if (value === undefined) throw new ValidationAppError(`No default supplied for key '${rule.defaultKey}' (target field ${rule.targetField})`);
          target[rule.targetField] = value;
          break;
        }
        case 'DERIVED_RULE': {
          const resolved = rule.derivedFrom!.map((f) => source[f]).find((v) => v !== undefined && v !== null);
          target[rule.targetField] = resolved;
          break;
        }
        case 'LOOKUP': {
          const key = String(source[rule.sourceField!]);
          if (!(key in rule.lookupTable!)) throw new ValidationAppError(`LOOKUP mapping for ${rule.targetField}: no entry for key '${key}'`);
          target[rule.targetField] = rule.lookupTable![key];
          break;
        }
        case 'USER_REQUIRED': {
          const value = context.userSuppliedFields?.[rule.targetField];
          if (value === undefined) throw new ValidationAppError(`Field '${rule.targetField}' requires user input and none was supplied`);
          target[rule.targetField] = value;
          break;
        }
      }
    }
    return target;
  }

  validateLineMapping(rules: LineMappingRule[]): void {
    if (!Array.isArray(rules)) throw new ValidationAppError('lineMapping must be an array');
    for (const rule of rules) {
      if (!rule.sourceLineType || !rule.targetLineType) throw new ValidationAppError('Every line mapping rule needs sourceLineType and targetLineType');
    }
  }

  resolveLineRule(rules: LineMappingRule[], sourceLineType: string): LineMappingRule {
    const rule = rules.find((r) => r.sourceLineType === sourceLineType);
    if (!rule) throw new ValidationAppError(`No line mapping rule for source line type '${sourceLineType}'`);
    return rule;
  }
}
