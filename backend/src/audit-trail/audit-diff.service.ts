import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

export interface FieldDiff {
  fieldPath: string;
  changeType: 'ITEM_ADDED' | 'ITEM_REMOVED' | 'ITEM_UPDATED' | 'ITEM_REORDERED';
  oldValue: unknown;
  newValue: unknown;
}

const SENSITIVE_FIELD_NAMES = new Set(['iban', 'bankAccountNumber', 'accountNumber', 'taxId', 'salary', 'personalId', 'passwordHash']);

/**
 * AuditDiffService (docx spec Phase 25, sections 8-13). Computes
 * before/after field diffs using STABLE identifiers for collections
 * (spec section 9's own "Index-based diff history üçün zəifdir" — a
 * line array is diffed by its own `id` field, never by array position)
 * and flags sensitive fields for redaction rather than ever storing a
 * raw secret value (spec section 12).
 */
@Injectable()
export class AuditDiffService {
  constructor(private readonly prisma: PrismaService) {}

  /** Shallow + one-level-nested-array diff. `before`/`after` are plain
   * objects; any array-valued field is treated as a collection of
   * `{id, ...}` items diffed by `id` (spec section 9's stable-identifier
   * requirement) — a collection field without an `id` on its items
   * falls back to a single ITEM_UPDATED diff of the whole array. */
  diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldDiff[] {
    const changes: FieldDiff[] = [];
    const beforeObj = before ?? {};
    const afterObj = after ?? {};
    const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

    for (const key of keys) {
      const oldVal = beforeObj[key];
      const newVal = afterObj[key];
      if (Array.isArray(oldVal) || Array.isArray(newVal)) {
        changes.push(...this.diffCollection(key, (oldVal as unknown[]) ?? [], (newVal as unknown[]) ?? []));
        continue;
      }
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ fieldPath: key, changeType: 'ITEM_UPDATED', oldValue: oldVal, newValue: newVal });
      }
    }
    return changes;
  }

  private diffCollection(fieldName: string, before: unknown[], after: unknown[]): FieldDiff[] {
    const hasStableIds = [...before, ...after].every((item) => typeof item === 'object' && item !== null && 'id' in (item as object));
    if (!hasStableIds) {
      if (JSON.stringify(before) !== JSON.stringify(after)) return [{ fieldPath: fieldName, changeType: 'ITEM_UPDATED', oldValue: before, newValue: after }];
      return [];
    }
    const beforeById = new Map((before as Record<string, unknown>[]).map((i) => [i.id as string, i]));
    const afterById = new Map((after as Record<string, unknown>[]).map((i) => [i.id as string, i]));
    const changes: FieldDiff[] = [];
    for (const [id, item] of afterById) {
      if (!beforeById.has(id)) changes.push({ fieldPath: `${fieldName}[line_id=${id}]`, changeType: 'ITEM_ADDED', oldValue: null, newValue: item });
      else if (JSON.stringify(beforeById.get(id)) !== JSON.stringify(item)) changes.push({ fieldPath: `${fieldName}[line_id=${id}]`, changeType: 'ITEM_UPDATED', oldValue: beforeById.get(id), newValue: item });
    }
    for (const [id, item] of beforeById) {
      if (!afterById.has(id)) changes.push({ fieldPath: `${fieldName}[line_id=${id}]`, changeType: 'ITEM_REMOVED', oldValue: item, newValue: null });
    }
    return changes;
  }

  /** Persists the computed diffs as `AuditFieldChange` rows linked to an
   * already-created `AuditEvent` — sensitive fields (by name) are
   * redacted to a fingerprint hash rather than the raw value (spec
   * sections 12-13, 174). */
  async persist(tenantId: string, auditEventId: string, changes: FieldDiff[], tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const rows = [];
    for (const change of changes) {
      const baseName = change.fieldPath.split('[')[0].split('.').pop() ?? change.fieldPath;
      const isSensitive = SENSITIVE_FIELD_NAMES.has(baseName);
      rows.push(
        await client.auditFieldChange.create({
          data: {
            tenantId,
            auditEventId,
            fieldPath: change.fieldPath,
            changeType: change.changeType,
            oldValue: isSensitive ? undefined : (change.oldValue as object),
            newValue: isSensitive ? undefined : (change.newValue as object),
            isSensitive,
            redactionPolicy: isSensitive ? 'FINGERPRINT_ONLY' : undefined,
            normalizedOldHash: isSensitive ? this.fingerprint(change.oldValue) : undefined,
            normalizedNewHash: isSensitive ? this.fingerprint(change.newValue) : undefined,
          },
        }),
      );
    }
    return rows;
  }

  private fingerprint(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
  }
}
