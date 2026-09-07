/**
 * Explicit machine-readable permission codes (section 6). Business modules
 * added in later phases append their own `<module>.<resource>.<action>`
 * codes here/in their own module — never hardcode role names in logic.
 */
export const PermissionCodes = {
  CORE_USERS_VIEW: 'core.users.view',
  CORE_USERS_MANAGE: 'core.users.manage',
  CORE_ROLES_VIEW: 'core.roles.view',
  CORE_ROLES_MANAGE: 'core.roles.manage',
  CORE_TENANT_MANAGE: 'core.tenant.manage',
  CORE_SETTINGS_VIEW: 'core.settings.view',
  CORE_SETTINGS_MANAGE: 'core.settings.manage',

  DOCUMENTS_VIEW: 'documents.view',
  DOCUMENTS_CREATE: 'documents.create',
  DOCUMENTS_EDIT: 'documents.edit',
  DOCUMENTS_DELETE: 'documents.delete',
  DOCUMENTS_POST: 'documents.post',
  DOCUMENTS_UNPOST: 'documents.unpost',
  DOCUMENTS_CANCEL: 'documents.cancel',

  PERIODS_VIEW: 'periods.view',
  PERIODS_CLOSE: 'periods.close',
  PERIODS_REOPEN: 'periods.reopen',

  AUDIT_VIEW: 'audit.view',

  CURRENCY_MANAGE: 'currency.manage',
  NUMBERING_MANAGE: 'numbering.manage',

  // Phase 1 — Organization & Business Structure (section 34)
  ORGANIZATION_VIEW: 'organization.view',
  ORGANIZATION_CREATE: 'organization.create',
  ORGANIZATION_EDIT: 'organization.edit',
  ORGANIZATION_DEACTIVATE: 'organization.deactivate',

  BRANCH_VIEW: 'branch.view',
  BRANCH_CREATE: 'branch.create',
  BRANCH_EDIT: 'branch.edit',
  BRANCH_DEACTIVATE: 'branch.deactivate',

  DEPARTMENT_VIEW: 'department.view',
  DEPARTMENT_CREATE: 'department.create',
  DEPARTMENT_EDIT: 'department.edit',
  DEPARTMENT_DEACTIVATE: 'department.deactivate',

  RESPONSIBLE_PERSON_VIEW: 'responsible_person.view',
  RESPONSIBLE_PERSON_MANAGE: 'responsible_person.manage',

  WAREHOUSE_VIEW: 'warehouse.view',
  WAREHOUSE_CREATE: 'warehouse.create',
  WAREHOUSE_EDIT: 'warehouse.edit',
  WAREHOUSE_DEACTIVATE: 'warehouse.deactivate',

  CASHBOX_VIEW: 'cashbox.view',
  CASHBOX_CREATE: 'cashbox.create',
  CASHBOX_EDIT: 'cashbox.edit',
  CASHBOX_DEACTIVATE: 'cashbox.deactivate',

  BANK_ACCOUNT_VIEW: 'bank_account.view',
  BANK_ACCOUNT_CREATE: 'bank_account.create',
  BANK_ACCOUNT_EDIT: 'bank_account.edit',
  BANK_ACCOUNT_DEACTIVATE: 'bank_account.deactivate',

  ACCOUNTING_POLICY_VIEW: 'accounting_policy.view',
  ACCOUNTING_POLICY_MANAGE: 'accounting_policy.manage',

  TAX_PROFILE_VIEW: 'tax_profile.view',
  TAX_PROFILE_MANAGE: 'tax_profile.manage',

  ORGANIZATION_ACCESS_MANAGE: 'organization_access.manage',
} as const;

export const ALL_PERMISSION_CODES: { code: string; module: string; description: string }[] = [
  { code: PermissionCodes.CORE_USERS_VIEW, module: 'core', description: 'View users in the tenant' },
  { code: PermissionCodes.CORE_USERS_MANAGE, module: 'core', description: 'Manage tenant memberships' },
  { code: PermissionCodes.CORE_ROLES_VIEW, module: 'core', description: 'View roles and permissions' },
  { code: PermissionCodes.CORE_ROLES_MANAGE, module: 'core', description: 'Manage roles and role permissions' },
  { code: PermissionCodes.CORE_TENANT_MANAGE, module: 'core', description: 'Manage tenant-level configuration' },
  { code: PermissionCodes.CORE_SETTINGS_VIEW, module: 'core', description: 'View scoped settings' },
  { code: PermissionCodes.CORE_SETTINGS_MANAGE, module: 'core', description: 'Manage scoped settings' },

  { code: PermissionCodes.DOCUMENTS_VIEW, module: 'documents', description: 'View documents' },
  { code: PermissionCodes.DOCUMENTS_CREATE, module: 'documents', description: 'Create documents' },
  { code: PermissionCodes.DOCUMENTS_EDIT, module: 'documents', description: 'Edit documents' },
  { code: PermissionCodes.DOCUMENTS_DELETE, module: 'documents', description: 'Mark documents for deletion' },
  { code: PermissionCodes.DOCUMENTS_POST, module: 'documents', description: 'Post documents' },
  { code: PermissionCodes.DOCUMENTS_UNPOST, module: 'documents', description: 'Unpost documents' },
  { code: PermissionCodes.DOCUMENTS_CANCEL, module: 'documents', description: 'Cancel documents' },

  { code: PermissionCodes.PERIODS_VIEW, module: 'periods', description: 'View accounting periods' },
  { code: PermissionCodes.PERIODS_CLOSE, module: 'periods', description: 'Close accounting periods' },
  { code: PermissionCodes.PERIODS_REOPEN, module: 'periods', description: 'Reopen accounting periods' },

  { code: PermissionCodes.AUDIT_VIEW, module: 'audit', description: 'View audit events' },

  { code: PermissionCodes.CURRENCY_MANAGE, module: 'currency', description: 'Manage currencies and exchange rates' },
  { code: PermissionCodes.NUMBERING_MANAGE, module: 'numbering', description: 'Manage numbering sequences' },

  { code: PermissionCodes.ORGANIZATION_VIEW, module: 'organization', description: 'View organizations' },
  { code: PermissionCodes.ORGANIZATION_CREATE, module: 'organization', description: 'Create organizations' },
  { code: PermissionCodes.ORGANIZATION_EDIT, module: 'organization', description: 'Edit organizations' },
  { code: PermissionCodes.ORGANIZATION_DEACTIVATE, module: 'organization', description: 'Deactivate organizations' },

  { code: PermissionCodes.BRANCH_VIEW, module: 'branch', description: 'View branches' },
  { code: PermissionCodes.BRANCH_CREATE, module: 'branch', description: 'Create branches' },
  { code: PermissionCodes.BRANCH_EDIT, module: 'branch', description: 'Edit branches' },
  { code: PermissionCodes.BRANCH_DEACTIVATE, module: 'branch', description: 'Deactivate branches' },

  { code: PermissionCodes.DEPARTMENT_VIEW, module: 'department', description: 'View departments' },
  { code: PermissionCodes.DEPARTMENT_CREATE, module: 'department', description: 'Create departments' },
  { code: PermissionCodes.DEPARTMENT_EDIT, module: 'department', description: 'Edit departments' },
  { code: PermissionCodes.DEPARTMENT_DEACTIVATE, module: 'department', description: 'Deactivate departments' },

  { code: PermissionCodes.RESPONSIBLE_PERSON_VIEW, module: 'responsible_person', description: 'View responsible persons' },
  { code: PermissionCodes.RESPONSIBLE_PERSON_MANAGE, module: 'responsible_person', description: 'Manage responsible persons' },

  { code: PermissionCodes.WAREHOUSE_VIEW, module: 'warehouse', description: 'View warehouses' },
  { code: PermissionCodes.WAREHOUSE_CREATE, module: 'warehouse', description: 'Create warehouses' },
  { code: PermissionCodes.WAREHOUSE_EDIT, module: 'warehouse', description: 'Edit warehouses' },
  { code: PermissionCodes.WAREHOUSE_DEACTIVATE, module: 'warehouse', description: 'Deactivate warehouses' },

  { code: PermissionCodes.CASHBOX_VIEW, module: 'cashbox', description: 'View cashboxes' },
  { code: PermissionCodes.CASHBOX_CREATE, module: 'cashbox', description: 'Create cashboxes' },
  { code: PermissionCodes.CASHBOX_EDIT, module: 'cashbox', description: 'Edit cashboxes' },
  { code: PermissionCodes.CASHBOX_DEACTIVATE, module: 'cashbox', description: 'Deactivate cashboxes' },

  { code: PermissionCodes.BANK_ACCOUNT_VIEW, module: 'bank_account', description: 'View bank accounts' },
  { code: PermissionCodes.BANK_ACCOUNT_CREATE, module: 'bank_account', description: 'Create bank accounts' },
  { code: PermissionCodes.BANK_ACCOUNT_EDIT, module: 'bank_account', description: 'Edit bank accounts' },
  { code: PermissionCodes.BANK_ACCOUNT_DEACTIVATE, module: 'bank_account', description: 'Deactivate bank accounts' },

  { code: PermissionCodes.ACCOUNTING_POLICY_VIEW, module: 'accounting_policy', description: 'View accounting policies' },
  { code: PermissionCodes.ACCOUNTING_POLICY_MANAGE, module: 'accounting_policy', description: 'Manage accounting policies' },

  { code: PermissionCodes.TAX_PROFILE_VIEW, module: 'tax_profile', description: 'View tax profiles' },
  { code: PermissionCodes.TAX_PROFILE_MANAGE, module: 'tax_profile', description: 'Manage tax profiles' },

  { code: PermissionCodes.ORGANIZATION_ACCESS_MANAGE, module: 'organization_access', description: 'Grant/revoke organization access' },
];
