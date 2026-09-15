import { Injectable } from '@nestjs/common';
import { ValidationAppError } from '../common/errors/app-error';

export type ConditionNode =
  | { op: 'AND' | 'OR'; clauses: ConditionNode[] }
  | { op: 'NOT'; clause: ConditionNode }
  | { op: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE'; field: string; value: unknown }
  | { op: 'IN' | 'NOT_IN'; field: string; value: unknown[] }
  | { op: 'EXISTS'; field: string }
  | { op: 'BETWEEN'; field: string; min: unknown; max: unknown };

/**
 * WorkflowConditionService (docx spec Phase 26, sections 21-23, 96).
 * A small, safe expression tree — no `eval`/`Function`/scripting engine
 * of any kind (spec section 22's own critical rule). Conditions read
 * from the GOVERNED trigger context only (spec section 9 — amount,
 * currency, counterparty, department, cost center, risk, ...), never
 * arbitrary frontend JSON.
 */
@Injectable()
export class WorkflowConditionService {
  evaluate(node: ConditionNode, context: Record<string, unknown>): boolean {
    switch (node.op) {
      case 'AND':
        return node.clauses.every((c) => this.evaluate(c, context));
      case 'OR':
        return node.clauses.some((c) => this.evaluate(c, context));
      case 'NOT':
        return !this.evaluate(node.clause, context);
      case 'EXISTS':
        return this.resolveField(context, node.field) !== undefined && this.resolveField(context, node.field) !== null;
      case 'EQ':
        return this.resolveField(context, node.field) === node.value;
      case 'NEQ':
        return this.resolveField(context, node.field) !== node.value;
      case 'GT':
        return this.toNumber(this.resolveField(context, node.field)) > this.toNumber(node.value);
      case 'GTE':
        return this.toNumber(this.resolveField(context, node.field)) >= this.toNumber(node.value);
      case 'LT':
        return this.toNumber(this.resolveField(context, node.field)) < this.toNumber(node.value);
      case 'LTE':
        return this.toNumber(this.resolveField(context, node.field)) <= this.toNumber(node.value);
      case 'IN':
        return node.value.includes(this.resolveField(context, node.field));
      case 'NOT_IN':
        return !node.value.includes(this.resolveField(context, node.field));
      case 'BETWEEN': {
        const v = this.toNumber(this.resolveField(context, node.field));
        return v >= this.toNumber(node.min) && v <= this.toNumber(node.max);
      }
      default:
        throw new ValidationAppError(`Unknown condition operator: ${(node as { op: string }).op}`);
    }
  }

  /** Validates a condition tree's syntax (field paths resolve to a
   * plain dot-path string, operators are one of the known set) before a
   * workflow version can be activated (spec section 92). */
  validate(node: ConditionNode): void {
    if (!node || typeof node !== 'object' || !('op' in node)) throw new ValidationAppError('Invalid condition node');
    switch (node.op) {
      case 'AND':
      case 'OR':
        if (!Array.isArray(node.clauses) || node.clauses.length === 0) throw new ValidationAppError(`${node.op} requires at least one clause`);
        node.clauses.forEach((c) => this.validate(c));
        return;
      case 'NOT':
        this.validate(node.clause);
        return;
      default:
        if (!('field' in node) || typeof node.field !== 'string' || node.field.length === 0) throw new ValidationAppError(`Condition operator ${node.op} requires a field path`);
    }
  }

  private resolveField(context: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => (acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), context);
  }

  private toNumber(value: unknown): number {
    const n = Number(value);
    if (Number.isNaN(n)) throw new ValidationAppError(`Condition value is not numeric: ${JSON.stringify(value)}`);
    return n;
  }
}
