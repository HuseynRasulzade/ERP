import { Injectable } from '@nestjs/common';

export type AuditLevel = 'NONE' | 'METADATA_ONLY' | 'DIFF' | 'FULL_SNAPSHOT' | 'SENSITIVE_ACCESS' | 'HIGH_ASSURANCE';

const HIGH_ASSURANCE_RESOURCE_TYPES = new Set([
  'PeriodReopenRequest', // bank beneficiary change, payroll override, etc. flow through their own dedicated types below
  'BankAccount',
  'PayrollCalculationResult',
  'ManualJournalEntry',
  'FinancialReportSignature',
  'Role',
]);

const SENSITIVE_ACCESS_RESOURCE_TYPES = new Set(['Employee', 'PayrollCalculationResult', 'PhysicalPerson', 'BankAccount', 'FinancialReportRun']);

/**
 * AuditPolicyService (docx spec Phase 25, sections 48-50). Configurable
 * by entity type in this build (a resource-type -> level lookup) rather
 * than the full entity+field+operation+organization+sensitivity+
 * retention-class matrix spec section 48 describes — disclosed
 * simplification (docs/AUDIT_TRAIL.md section E). Distinguishes
 * ordinary sensitive-access logging from HIGH_ASSURANCE events (spec
 * section 50 — period reopen, bank beneficiary change, payroll
 * override, manual journal, tax rule change, signed report, permission
 * escalation) which callers should route through
 * `AuditService.record` with `severity: 'CRITICAL'` in addition to
 * normal category tagging.
 */
@Injectable()
export class AuditPolicyService {
  async shouldAuditAccess(_tenantId: string, resourceType: string): Promise<boolean> {
    return SENSITIVE_ACCESS_RESOURCE_TYPES.has(resourceType);
  }

  isHighAssurance(resourceType: string): boolean {
    return HIGH_ASSURANCE_RESOURCE_TYPES.has(resourceType);
  }

  levelFor(resourceType: string): AuditLevel {
    if (this.isHighAssurance(resourceType)) return 'HIGH_ASSURANCE';
    if (SENSITIVE_ACCESS_RESOURCE_TYPES.has(resourceType)) return 'SENSITIVE_ACCESS';
    return 'DIFF';
  }
}
