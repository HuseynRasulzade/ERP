import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../common/context/request-context.service';
import { PermissionCodes } from '../rbac/permission-codes';

/** PhysicalPerson fields that are personal data (spec 61/62): a manager or
 * a plain HR viewer sees name/position, never these. */
export const PERSONAL_DATA_FIELDS = [
  'personalId',
  'taxId',
  'passportNumber',
  'identityDocuments',
  'birthDate',
  'nationality',
  'gender',
  'personalEmail',
  'personalPhone',
  'address',
  'emergencyContact',
] as const;

/**
 * Field-level authorization (spec 61/62). Endpoints are gated by coarse
 * permissions in the controller; this service strips fields a caller may
 * not see from otherwise-visible records, always server-side. Every read
 * path that returns person / contract / attribute / bank / document data
 * goes through it, so adding a finer rule later touches one place.
 */
@Injectable()
export class HrSecurityService {
  constructor(private readonly ctx: RequestContextService) {}

  can(code: string) {
    return this.ctx.hasPermission(code);
  }

  canViewPersonalData() {
    return this.can(PermissionCodes.HR_VIEW_PERSONAL_DATA);
  }

  redactPerson<T extends Record<string, any> | null | undefined>(person: T): T {
    if (!person || this.canViewPersonalData()) return person;
    const copy: Record<string, any> = { ...person };
    for (const f of PERSONAL_DATA_FIELDS) if (f in copy) copy[f] = null;
    copy.redactedFields = [...PERSONAL_DATA_FIELDS];
    return copy as T;
  }

  redactContract<T extends Record<string, any> | null | undefined>(contract: T): T {
    if (!contract || this.can(PermissionCodes.HR_VIEW_COMPENSATION)) return contract;
    const copy: Record<string, any> = { ...contract };
    if ('baseCompensationReference' in copy) copy.baseCompensationReference = null;
    if (copy.terms && typeof copy.terms === 'object') copy.terms = { ...copy.terms, baseCompensationReference: null };
    if (Array.isArray(copy.versions)) copy.versions = copy.versions.map((v: any) => this.redactContract(v));
    return copy as T;
  }

  /** Sensitive effective-dated attributes (tax/social/disability ...). */
  filterAttributes<T extends { sensitive: boolean }>(rows: T[]): T[] {
    if (this.can(PermissionCodes.HR_VIEW_SENSITIVE_DATA)) return rows;
    return rows.filter((r) => !r.sensitive);
  }

  /** Personnel documents: MEDICAL needs hr.medical.view, PERSONAL needs
   * hr.personal_data.view, NORMAL is visible to any HR viewer. */
  filterDocuments<T extends { sensitivity: string }>(rows: T[]): T[] {
    return rows.filter((r) => {
      if (r.sensitivity === 'MEDICAL') return this.can(PermissionCodes.HR_VIEW_MEDICAL);
      if (r.sensitivity === 'PERSONAL') return this.canViewPersonalData();
      return true;
    });
  }
}
