/**
 * Phase 17 HR Core — shared vocabulary. Kept as string unions (not Prisma
 * enums) so localization packs can extend catalogs without a migration
 * (spec 9/39/44 "localization extension point").
 */

export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'TEMPORARY',
  'FIXED_TERM',
  'CONTRACT',
  'INTERNSHIP',
  'SECONDARY_EMPLOYMENT',
  'SEASONAL',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_STATUSES = ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE', 'TERMINATED', 'CANCELLED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/** Statuses in which a person is "employed" on a date (counts in headcount,
 * payroll-eligible population, Phase 18 planned time). */
export const EMPLOYED_STATUSES: EmploymentStatus[] = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'];

export const TRANSFER_TYPES = [
  'DEPARTMENT_TRANSFER',
  'POSITION_CHANGE',
  'PROMOTION',
  'DEMOTION',
  'BRANCH_TRANSFER',
  'LOCATION_TRANSFER',
  'MANAGER_CHANGE',
  'FTE_CHANGE',
  'COMBINED_TRANSFER',
] as const;

export const CONTRACT_TYPES = ['INDEFINITE', 'FIXED_TERM', 'SEASONAL', 'INTERNSHIP', 'CIVIL'] as const;

export const HR_DOCUMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED', 'REVERSED'] as const;
export type HrDocumentStatus = (typeof HR_DOCUMENT_STATUSES)[number];

/** Document/entity type codes used for numbering, DocumentLink, audit and
 * the `sourceDocumentType` column of every history row. */
export const HrDocType = {
  PERSON: 'HR_PHYSICAL_PERSON',
  EMPLOYEE: 'HR_EMPLOYEE',
  EMPLOYMENT: 'HR_EMPLOYMENT',
  CONTRACT: 'HR_CONTRACT',
  CONTRACT_AMENDMENT: 'HR_CONTRACT_AMENDMENT',
  HIRE: 'HR_HIRE',
  REHIRE: 'HR_REHIRE',
  TRANSFER: 'HR_TRANSFER',
  TERMINATION: 'HR_TERMINATION',
  SCHEDULE_CHANGE: 'HR_SCHEDULE_CHANGE',
  SUSPENSION: 'HR_SUSPENSION',
  RETURN_TO_WORK: 'HR_RETURN_TO_WORK',
  LEAVE: 'HR_LEAVE',
  ABSENCE: 'HR_ABSENCE',
  BUSINESS_TRIP: 'HR_BUSINESS_TRIP',
  STAFFING_TABLE: 'HR_STAFFING_TABLE',
  STAFFING_POSITION: 'HR_STAFFING_POSITION',
} as const;

/** Outbox event names (spec 119). Every payload carries employee_id,
 * employment_id, organization, effective_date, old/new state and source
 * document (spec 120). */
export const HrEventType = {
  PHYSICAL_PERSON_CREATED: 'PHYSICAL_PERSON_CREATED',
  EMPLOYEE_CREATED: 'EMPLOYEE_CREATED',
  EMPLOYMENT_PLANNED: 'EMPLOYMENT_PLANNED',
  EMPLOYEE_HIRED: 'EMPLOYEE_HIRED',
  EMPLOYEE_REHIRED: 'EMPLOYEE_REHIRED',
  EMPLOYEE_TRANSFERRED: 'EMPLOYEE_TRANSFERRED',
  EMPLOYEE_POSITION_CHANGED: 'EMPLOYEE_POSITION_CHANGED',
  EMPLOYEE_DEPARTMENT_CHANGED: 'EMPLOYEE_DEPARTMENT_CHANGED',
  EMPLOYEE_MANAGER_CHANGED: 'EMPLOYEE_MANAGER_CHANGED',
  EMPLOYEE_FTE_CHANGED: 'EMPLOYEE_FTE_CHANGED',
  EMPLOYEE_SCHEDULE_CHANGED: 'EMPLOYEE_SCHEDULE_CHANGED',
  EMPLOYEE_SUSPENDED: 'EMPLOYEE_SUSPENDED',
  EMPLOYEE_RETURNED_TO_WORK: 'EMPLOYEE_RETURNED_TO_WORK',
  EMPLOYEE_LEAVE_REGISTERED: 'EMPLOYEE_LEAVE_REGISTERED',
  EMPLOYEE_ABSENCE_REGISTERED: 'EMPLOYEE_ABSENCE_REGISTERED',
  EMPLOYEE_TERMINATED: 'EMPLOYEE_TERMINATED',
  EMPLOYEE_TERMINATION_REVERSED: 'EMPLOYEE_TERMINATION_REVERSED',
  EMPLOYEE_HIRE_REVERSED: 'EMPLOYEE_HIRE_REVERSED',
  EMPLOYEE_TRANSFER_REVERSED: 'EMPLOYEE_TRANSFER_REVERSED',
  CONTRACT_AMENDED: 'CONTRACT_AMENDED',
  STAFFING_POSITION_CHANGED: 'STAFFING_POSITION_CHANGED',
  HR_RECALCULATION_REQUIRED: 'HR_RECALCULATION_REQUIRED',
} as const;

export const HrCatalogType = {
  TERMINATION_REASON: 'TERMINATION_REASON',
  LEAVE_TYPE: 'LEAVE_TYPE',
  ABSENCE_TYPE: 'ABSENCE_TYPE',
  SUSPENSION_REASON: 'SUSPENSION_REASON',
  ATTRIBUTE_TYPE: 'ATTRIBUTE_TYPE',
} as const;

/** System defaults provisioned per tenant on first use (spec 39/44/58). */
export const DEFAULT_HR_CATALOGS: Record<string, { code: string; name: string; nameAz: string; metadata?: Record<string, unknown> }[]> = {
  TERMINATION_REASON: [
    { code: 'RESIGNATION', name: 'Resignation', nameAz: 'Öz arzusu ilə' },
    { code: 'EMPLOYER_TERMINATION', name: 'Employer termination', nameAz: 'İşəgötürənin təşəbbüsü ilə' },
    { code: 'CONTRACT_EXPIRY', name: 'Contract expiry', nameAz: 'Müqavilə müddətinin bitməsi' },
    { code: 'RETIREMENT', name: 'Retirement', nameAz: 'Pensiyaya çıxma' },
    { code: 'REDUNDANCY', name: 'Redundancy', nameAz: 'İxtisar' },
    { code: 'MUTUAL_AGREEMENT', name: 'Mutual agreement', nameAz: 'Tərəflərin razılığı ilə' },
    { code: 'DEATH', name: 'Death', nameAz: 'Vəfat' },
    { code: 'TRANSFER_TO_ANOTHER_ENTITY', name: 'Transfer to another legal entity', nameAz: 'Başqa hüquqi şəxsə keçid' },
    { code: 'OTHER', name: 'Other', nameAz: 'Digər' },
  ],
  LEAVE_TYPE: [
    { code: 'ANNUAL', name: 'Annual leave', nameAz: 'Əmək məzuniyyəti' },
    { code: 'UNPAID', name: 'Unpaid leave', nameAz: 'Ödənişsiz məzuniyyət' },
    { code: 'MATERNITY', name: 'Maternity leave', nameAz: 'Analıq məzuniyyəti' },
    { code: 'PATERNITY', name: 'Paternity leave', nameAz: 'Atalıq məzuniyyəti' },
    { code: 'STUDY', name: 'Study leave', nameAz: 'Təhsil məzuniyyəti' },
    { code: 'MEDICAL', name: 'Medical leave', nameAz: 'Tibbi məzuniyyət' },
    { code: 'OTHER', name: 'Other leave', nameAz: 'Digər' },
  ],
  ABSENCE_TYPE: [
    { code: 'SICK', name: 'Sickness', nameAz: 'Xəstəlik' },
    { code: 'UNEXCUSED', name: 'Unexcused absence', nameAz: 'Üzrsüz səbəbdən işə gəlməmə' },
    { code: 'EXCUSED', name: 'Excused absence', nameAz: 'Üzrlü səbəb' },
    { code: 'DOWNTIME', name: 'Downtime', nameAz: 'Boş dayanma' },
    { code: 'OTHER', name: 'Other', nameAz: 'Digər' },
  ],
  SUSPENSION_REASON: [
    { code: 'UNPAID_LEAVE', name: 'Unpaid leave', nameAz: 'Ödənişsiz məzuniyyət' },
    { code: 'MILITARY_SERVICE', name: 'Military service', nameAz: 'Hərbi xidmət' },
    { code: 'LEGAL_SUSPENSION', name: 'Legal suspension', nameAz: 'Qanuni dayandırma' },
    { code: 'PARENTAL_LEAVE', name: 'Parental leave', nameAz: 'Uşağa qulluq məzuniyyəti' },
    { code: 'OTHER', name: 'Other', nameAz: 'Digər' },
  ],
  ATTRIBUTE_TYPE: [
    { code: 'TAX_STATUS', name: 'Tax status', nameAz: 'Vergi statusu', metadata: { sensitive: true } },
    { code: 'RESIDENT_STATUS', name: 'Resident status', nameAz: 'Rezidentlik statusu', metadata: { sensitive: true } },
    { code: 'SOCIAL_INSURANCE_CATEGORY', name: 'Social insurance category', nameAz: 'Sosial sığorta kateqoriyası', metadata: { sensitive: true } },
    { code: 'DISABILITY_CATEGORY', name: 'Disability category', nameAz: 'Əlillik dərəcəsi', metadata: { sensitive: true } },
    { code: 'EDUCATION_LEVEL', name: 'Education level', nameAz: 'Təhsil səviyyəsi', metadata: { sensitive: false } },
  ],
};

/** Configurable HR policy (spec 18/67/73/81/…), stored as the tenant
 * setting `hr.policy` (effective-dated via SettingsService) and merged over
 * these defaults. */
export interface HrPolicy {
  overstaffPolicy: 'BLOCK' | 'WARNING' | 'APPROVAL_REQUIRED' | 'ALLOW';
  duplicateEmploymentPolicy: 'BLOCK' | 'WARNING' | 'ALLOW';
  primaryEmploymentScope: 'TENANT' | 'ORGANIZATION';
  maxEmploymentFte: number;
  maxAggregateFte: number;
  requireContract: boolean;
  requireSignedContract: boolean;
  requireApproval: boolean;
  segregationOfDuties: boolean;
  requireManager: boolean;
  auditSensitiveViews: boolean;
}

export const DEFAULT_HR_POLICY: HrPolicy = {
  overstaffPolicy: 'BLOCK',
  duplicateEmploymentPolicy: 'BLOCK',
  primaryEmploymentScope: 'TENANT',
  maxEmploymentFte: 1,
  maxAggregateFte: 1.5,
  requireContract: true,
  requireSignedContract: false,
  requireApproval: false,
  segregationOfDuties: true,
  requireManager: false,
  auditSensitiveViews: true,
};

export const HR_POLICY_SETTING_KEY = 'hr.policy';
