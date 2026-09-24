import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { addDays } from './fixed-assets.constants';

export interface AssignmentValues {
  branchId?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  responsiblePersonId?: string | null;
  costCenterId?: string | null;
  projectId?: string | null;
  expenseType?: string | null;
}

const ASSIGNMENT_FIELDS: (keyof AssignmentValues)[] = ['branchId', 'departmentId', 'locationId', 'responsiblePersonId', 'costCenterId', 'projectId', 'expenseType'];

/**
 * Effective-dated assignment history + parameter change log (spec sections
 * 41-44, 105, 128, 137). The FixedAsset "current" columns are a projection;
 * history rows are never overwritten — a reversal flags them `reversed`.
 */
@Injectable()
export class FixedAssetHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async recordParameter(
    tx: PrismaTransactionClient,
    input: { tenantId: string; assetId: string; parameterCode: string; oldValue: unknown; newValue: unknown; effectiveDate: Date; sourceDocumentType?: string; sourceDocumentId?: string; reason?: string | null; createdBy?: string },
  ) {
    const s = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    if (s(input.oldValue) === s(input.newValue)) return null;
    return tx.fixedAssetParameterHistory.create({
      data: {
        tenantId: input.tenantId,
        assetId: input.assetId,
        parameterCode: input.parameterCode,
        oldValue: s(input.oldValue),
        newValue: s(input.newValue),
        effectiveDate: input.effectiveDate,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        reason: input.reason ?? undefined,
        createdBy: input.createdBy,
      },
    });
  }

  async currentAssignment(tenantId: string, assetId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.fixedAssetAssignment.findFirst({ where: { tenantId, assetId, reversed: false, validTo: null }, orderBy: { validFrom: 'desc' } });
  }

  /** Assignment in force on a date (spec section 42 — depreciation expense
   * dimensions follow the assignment effective for the period). */
  async assignmentAt(tenantId: string, assetId: string, date: Date, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.fixedAssetAssignment.findFirst({
      where: { tenantId, assetId, reversed: false, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
      orderBy: { validFrom: 'desc' },
    });
  }

  /** Closes the current assignment the day before `validFrom` and opens a
   * new one (unspecified fields inherit the current values). Updates the
   * FixedAsset projection columns and logs every changed field. */
  async assign(
    tx: PrismaTransactionClient,
    input: { tenantId: string; assetId: string; validFrom: Date; values: AssignmentValues; sourceDocumentType: string; sourceDocumentId: string; createdBy?: string; reason?: string | null },
  ) {
    const current = await this.currentAssignment(input.tenantId, input.assetId, tx);
    const merged: AssignmentValues = {};
    for (const f of ASSIGNMENT_FIELDS) {
      merged[f] = input.values[f] !== undefined ? input.values[f] : ((current as any)?.[f] ?? null);
    }
    if (current) {
      if (current.validFrom.getTime() >= input.validFrom.getTime()) {
        // Same-day (or back-dated onto the start) re-assignment: the previous
        // slice never became effective — close it on its own start date.
        await tx.fixedAssetAssignment.update({ where: { id: current.id }, data: { validTo: current.validFrom } });
      } else {
        await tx.fixedAssetAssignment.update({ where: { id: current.id }, data: { validTo: addDays(input.validFrom, -1) } });
      }
    }
    const created = await tx.fixedAssetAssignment.create({
      data: {
        tenantId: input.tenantId,
        assetId: input.assetId,
        validFrom: input.validFrom,
        ...merged,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        createdBy: input.createdBy,
      },
    });
    const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id: input.assetId } });
    for (const f of ASSIGNMENT_FIELDS) {
      await this.recordParameter(tx, {
        tenantId: input.tenantId,
        assetId: input.assetId,
        parameterCode: f,
        oldValue: (asset as any)[f],
        newValue: merged[f],
        effectiveDate: input.validFrom,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        reason: input.reason,
        createdBy: input.createdBy,
      });
    }
    await tx.fixedAsset.update({ where: { id: input.assetId }, data: { ...merged } });
    return { previous: current, created };
  }

  /** Undo the assignments a reversed document created: flag them reversed,
   * re-open the slice they closed, and re-project the asset columns. */
  async reverseAssignments(tx: PrismaTransactionClient, tenantId: string, assetId: string, sourceType: string, sourceId: string) {
    const rows = await tx.fixedAssetAssignment.findMany({ where: { tenantId, assetId, sourceDocumentType: sourceType, sourceDocumentId: sourceId, reversed: false } });
    for (const row of rows) {
      await tx.fixedAssetAssignment.update({ where: { id: row.id }, data: { reversed: true } });
      const prev = await tx.fixedAssetAssignment.findFirst({
        where: { tenantId, assetId, reversed: false, id: { not: row.id }, validFrom: { lte: row.validFrom } },
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      });
      if (prev) await tx.fixedAssetAssignment.update({ where: { id: prev.id }, data: { validTo: null } });
    }
    const current = await this.currentAssignment(tenantId, assetId, tx);
    const data: AssignmentValues = {};
    for (const f of ASSIGNMENT_FIELDS) data[f] = (current as any)?.[f] ?? null;
    await tx.fixedAsset.update({ where: { id: assetId }, data: { ...data } });
  }
}
