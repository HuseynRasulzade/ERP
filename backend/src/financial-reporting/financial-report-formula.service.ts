import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * FinancialReportFormulaService (docx spec Phase 23, sections 70-72).
 * A deliberately tiny expression language — row-code tokens combined
 * with `+`/`-` only (spec section 70's own "Avoid arbitrary executable
 * code") — plus topological evaluation over the row dependency graph so
 * `A = B + C` genuinely requires B and C to be evaluated first, and a
 * real cycle (`A = B`, `B = A`) is rejected rather than silently
 * infinite-looping or returning a wrong zero.
 */
@Injectable()
export class FinancialReportFormulaService {
  /** Extracts the row-code tokens a formula string references (spec
   * section 71's own dependency graph — "Row A = B + C, Row B = D + E"). */
  parseDependencies(formula: string): string[] {
    return formula
      .split(/[+\-]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !/^\d+(\.\d+)?$/.test(t));
  }

  /** Kahn's-algorithm topological order over {rowCode -> formula} pairs.
   * Throws if a cycle exists (spec section 71's own "Formula cycles
   * blocked", tested by section 187's own A=B/B=A case). Rows with no
   * formula (plain DATA rows) are treated as already-resolved leaves. */
  topologicalOrder(formulas: Map<string, string>): string[] {
    const nodes = Array.from(formulas.keys());
    const inDegree = new Map<string, number>(nodes.map((n) => [n, 0]));
    const dependents = new Map<string, string[]>(nodes.map((n) => [n, []]));

    for (const [rowCode, formula] of formulas) {
      for (const dep of this.parseDependencies(formula)) {
        if (!formulas.has(dep)) continue; // dependency is a plain DATA row, not itself a formula node
        dependents.get(dep)!.push(rowCode);
        inDegree.set(rowCode, (inDegree.get(rowCode) ?? 0) + 1);
      }
    }

    const queue = nodes.filter((n) => (inDegree.get(n) ?? 0) === 0).sort();
    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      for (const dependent of dependents.get(current) ?? []) {
        const remaining = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) {
          queue.push(dependent);
          queue.sort();
        }
      }
    }

    if (order.length !== nodes.length) {
      const unresolved = nodes.filter((n) => !order.includes(n));
      throw new ValidationAppError(`Formula dependency cycle detected among rows: ${unresolved.join(', ')} (spec section 71/187)`);
    }
    return order;
  }

  /** Evaluates one formula given every row's already-resolved amount.
   * Division (for CALCULATED_RATIO rows) handled separately by the
   * caller via `safeDivide` — this only does +/-. */
  evaluate(formula: string, amounts: Map<string, Decimal>): Decimal {
    const tokens = formula.match(/[+-]|[^+\-\s]+/g) ?? [];
    let result = new Decimal(0);
    let sign = 1;
    for (const token of tokens) {
      if (token === '+') { sign = 1; continue; }
      if (token === '-') { sign = -1; continue; }
      result = result.plus(this.resolveToken(token.trim(), amounts).mul(sign));
    }
    return result;
  }

  private resolveToken(token: string, amounts: Map<string, Decimal>): Decimal {
    if (amounts.has(token)) return amounts.get(token)!;
    const asNumber = Number(token);
    return Number.isFinite(asNumber) ? new Decimal(asNumber) : new Decimal(0);
  }

  /** Divide-by-zero policy for CALCULATED_RATIO rows (spec section 72) —
   * returns null (displayed as "n/a") rather than throwing or silently
   * returning zero/Infinity. */
  safeDivide(numerator: Decimal, denominator: Decimal): Decimal | null {
    if (denominator.eq(0)) return null;
    return numerator.div(denominator);
  }
}
