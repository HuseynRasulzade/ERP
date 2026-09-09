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

  // Phase 2 — Product/Nomenclature master data
  UNIT_OF_MEASURE_VIEW: 'unit_of_measure.view',
  UNIT_OF_MEASURE_CREATE: 'unit_of_measure.create',
  UNIT_OF_MEASURE_EDIT: 'unit_of_measure.edit',
  UNIT_OF_MEASURE_DEACTIVATE: 'unit_of_measure.deactivate',

  PRODUCT_CATEGORY_VIEW: 'product_category.view',
  PRODUCT_CATEGORY_CREATE: 'product_category.create',
  PRODUCT_CATEGORY_EDIT: 'product_category.edit',
  PRODUCT_CATEGORY_DEACTIVATE: 'product_category.deactivate',

  PRODUCT_VIEW: 'product.view',
  PRODUCT_CREATE: 'product.create',
  PRODUCT_EDIT: 'product.edit',
  PRODUCT_DEACTIVATE: 'product.deactivate',

  // Phase 3 — Counterparty Master Data + Pricing
  UNIT_CONVERSION_VIEW: 'unit_conversion.view',
  UNIT_CONVERSION_CREATE: 'unit_conversion.create',
  UNIT_CONVERSION_EDIT: 'unit_conversion.edit',
  UNIT_CONVERSION_DEACTIVATE: 'unit_conversion.deactivate',

  COUNTERPARTY_VIEW: 'counterparty.view',
  COUNTERPARTY_CREATE: 'counterparty.create',
  COUNTERPARTY_EDIT: 'counterparty.edit',
  COUNTERPARTY_DEACTIVATE: 'counterparty.deactivate',

  PRICE_LIST_VIEW: 'price_list.view',
  PRICE_LIST_CREATE: 'price_list.create',
  PRICE_LIST_EDIT: 'price_list.edit',
  PRICE_LIST_DEACTIVATE: 'price_list.deactivate',

  PRODUCT_PRICE_VIEW: 'product_price.view',
  PRODUCT_PRICE_MANAGE: 'product_price.manage',

  // Phase 4 — Sales documents (orders + invoices)
  SALES_ORDER_VIEW: 'sales_order.view',
  SALES_ORDER_CREATE: 'sales_order.create',
  SALES_ORDER_EDIT: 'sales_order.edit',

  SALES_INVOICE_VIEW: 'sales_invoice.view',
  SALES_INVOICE_CREATE: 'sales_invoice.create',
  SALES_INVOICE_EDIT: 'sales_invoice.edit',

  // Accounting Core (docx spec Phase 4, section 100)
  ACCOUNTING_CHART_VIEW: 'accounting.chart.view',
  ACCOUNTING_CHART_MANAGE: 'accounting.chart.manage',
  ACCOUNTING_ACCOUNT_VIEW: 'accounting.account.view',
  ACCOUNTING_ACCOUNT_CREATE: 'accounting.account.create',
  ACCOUNTING_ACCOUNT_EDIT: 'accounting.account.edit',
  ACCOUNTING_ACCOUNT_DEACTIVATE: 'accounting.account.deactivate',
  ACCOUNTING_DIMENSION_VIEW: 'accounting.dimension.view',
  ACCOUNTING_DIMENSION_MANAGE: 'accounting.dimension.manage',
  ACCOUNTING_MAPPING_VIEW: 'accounting.mapping.view',
  ACCOUNTING_MAPPING_MANAGE: 'accounting.mapping.manage',
  ACCOUNTING_JOURNAL_VIEW: 'accounting.journal.view',
  ACCOUNTING_JOURNAL_POST: 'accounting.journal.post',
  ACCOUNTING_JOURNAL_UNPOST: 'accounting.journal.unpost',
  ACCOUNTING_JOURNAL_REVERSE: 'accounting.journal.reverse',
  ACCOUNTING_MANUAL_OPERATION_VIEW: 'accounting.manual_operation.view',
  ACCOUNTING_MANUAL_OPERATION_CREATE: 'accounting.manual_operation.create',
  ACCOUNTING_MANUAL_OPERATION_EDIT: 'accounting.manual_operation.edit',
  ACCOUNTING_MANUAL_OPERATION_POST: 'accounting.manual_operation.post',
  ACCOUNTING_MANUAL_OPERATION_UNPOST: 'accounting.manual_operation.unpost',
  ACCOUNTING_OPENING_BALANCE_VIEW: 'accounting.opening_balance.view',
  ACCOUNTING_OPENING_BALANCE_MANAGE: 'accounting.opening_balance.manage',
  ACCOUNTING_POSTING_HISTORY_VIEW: 'accounting.posting_history.view',
  ACCOUNTING_TRIAL_BALANCE_VIEW: 'accounting.trial_balance.view',
  ACCOUNTING_GENERAL_LEDGER_VIEW: 'accounting.general_ledger.view',

  // Tax Engine (docx spec Phase 5, section 97)
  TAX_CONFIG_VIEW: 'tax.config.view',
  TAX_RULE_VIEW: 'tax.rule.view',
  TAX_RULE_CREATE: 'tax.rule.create',
  TAX_RULE_EDIT: 'tax.rule.edit',
  TAX_RULE_APPROVE: 'tax.rule.approve',
  TAX_RULE_ACTIVATE: 'tax.rule.activate',
  TAX_RATE_VIEW: 'tax.rate.view',
  TAX_RATE_MANAGE: 'tax.rate.manage',
  TAX_CATEGORY_VIEW: 'tax.category.view',
  TAX_CATEGORY_MANAGE: 'tax.category.manage',
  TAX_REGISTRATION_VIEW: 'tax.registration.view',
  TAX_REGISTRATION_MANAGE: 'tax.registration.manage',
  TAX_MAPPING_VIEW: 'tax.mapping.view',
  TAX_MAPPING_MANAGE: 'tax.mapping.manage',
  TAX_LEGAL_SOURCE_VIEW: 'tax.legal_source.view',
  TAX_LEGAL_SOURCE_MANAGE: 'tax.legal_source.manage',
  TAX_CALCULATION_VIEW: 'tax.calculation.view',
  TAX_REGISTER_VIEW: 'tax.register.view',
  TAX_OVERRIDE: 'tax.override',
  TAX_PERIOD_VIEW: 'tax.period.view',
  TAX_PERIOD_MANAGE: 'tax.period.manage',
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

  { code: PermissionCodes.UNIT_OF_MEASURE_VIEW, module: 'unit_of_measure', description: 'View units of measure' },
  { code: PermissionCodes.UNIT_OF_MEASURE_CREATE, module: 'unit_of_measure', description: 'Create units of measure' },
  { code: PermissionCodes.UNIT_OF_MEASURE_EDIT, module: 'unit_of_measure', description: 'Edit units of measure' },
  { code: PermissionCodes.UNIT_OF_MEASURE_DEACTIVATE, module: 'unit_of_measure', description: 'Deactivate units of measure' },

  { code: PermissionCodes.PRODUCT_CATEGORY_VIEW, module: 'product_category', description: 'View product categories' },
  { code: PermissionCodes.PRODUCT_CATEGORY_CREATE, module: 'product_category', description: 'Create product categories' },
  { code: PermissionCodes.PRODUCT_CATEGORY_EDIT, module: 'product_category', description: 'Edit product categories' },
  { code: PermissionCodes.PRODUCT_CATEGORY_DEACTIVATE, module: 'product_category', description: 'Deactivate product categories' },

  { code: PermissionCodes.PRODUCT_VIEW, module: 'product', description: 'View products' },
  { code: PermissionCodes.PRODUCT_CREATE, module: 'product', description: 'Create products' },
  { code: PermissionCodes.PRODUCT_EDIT, module: 'product', description: 'Edit products' },
  { code: PermissionCodes.PRODUCT_DEACTIVATE, module: 'product', description: 'Deactivate products' },

  { code: PermissionCodes.UNIT_CONVERSION_VIEW, module: 'unit_conversion', description: 'View unit conversions' },
  { code: PermissionCodes.UNIT_CONVERSION_CREATE, module: 'unit_conversion', description: 'Create unit conversions' },
  { code: PermissionCodes.UNIT_CONVERSION_EDIT, module: 'unit_conversion', description: 'Edit unit conversions' },
  { code: PermissionCodes.UNIT_CONVERSION_DEACTIVATE, module: 'unit_conversion', description: 'Deactivate unit conversions' },

  { code: PermissionCodes.COUNTERPARTY_VIEW, module: 'counterparty', description: 'View counterparties' },
  { code: PermissionCodes.COUNTERPARTY_CREATE, module: 'counterparty', description: 'Create counterparties' },
  { code: PermissionCodes.COUNTERPARTY_EDIT, module: 'counterparty', description: 'Edit counterparties' },
  { code: PermissionCodes.COUNTERPARTY_DEACTIVATE, module: 'counterparty', description: 'Deactivate counterparties' },

  { code: PermissionCodes.PRICE_LIST_VIEW, module: 'price_list', description: 'View price lists' },
  { code: PermissionCodes.PRICE_LIST_CREATE, module: 'price_list', description: 'Create price lists' },
  { code: PermissionCodes.PRICE_LIST_EDIT, module: 'price_list', description: 'Edit price lists' },
  { code: PermissionCodes.PRICE_LIST_DEACTIVATE, module: 'price_list', description: 'Deactivate price lists' },

  { code: PermissionCodes.PRODUCT_PRICE_VIEW, module: 'product_price', description: 'View product prices' },
  { code: PermissionCodes.PRODUCT_PRICE_MANAGE, module: 'product_price', description: 'Manage product prices' },

  { code: PermissionCodes.SALES_ORDER_VIEW, module: 'sales_order', description: 'View sales orders' },
  { code: PermissionCodes.SALES_ORDER_CREATE, module: 'sales_order', description: 'Create sales orders' },
  { code: PermissionCodes.SALES_ORDER_EDIT, module: 'sales_order', description: 'Edit sales orders' },

  { code: PermissionCodes.SALES_INVOICE_VIEW, module: 'sales_invoice', description: 'View sales invoices' },
  { code: PermissionCodes.SALES_INVOICE_CREATE, module: 'sales_invoice', description: 'Create sales invoices' },
  { code: PermissionCodes.SALES_INVOICE_EDIT, module: 'sales_invoice', description: 'Edit sales invoices' },

  { code: PermissionCodes.ACCOUNTING_CHART_VIEW, module: 'accounting', description: 'View the chart of accounts' },
  { code: PermissionCodes.ACCOUNTING_CHART_MANAGE, module: 'accounting', description: 'Adopt/manage charts of accounts' },
  { code: PermissionCodes.ACCOUNTING_ACCOUNT_VIEW, module: 'accounting', description: 'View accounts' },
  { code: PermissionCodes.ACCOUNTING_ACCOUNT_CREATE, module: 'accounting', description: 'Create accounts/subaccounts' },
  { code: PermissionCodes.ACCOUNTING_ACCOUNT_EDIT, module: 'accounting', description: 'Edit accounts' },
  { code: PermissionCodes.ACCOUNTING_ACCOUNT_DEACTIVATE, module: 'accounting', description: 'Deactivate accounts' },
  { code: PermissionCodes.ACCOUNTING_DIMENSION_VIEW, module: 'accounting', description: 'View accounting dimensions' },
  { code: PermissionCodes.ACCOUNTING_DIMENSION_MANAGE, module: 'accounting', description: 'Manage accounting dimensions/rules' },
  { code: PermissionCodes.ACCOUNTING_MAPPING_VIEW, module: 'accounting', description: 'View accounting mappings' },
  { code: PermissionCodes.ACCOUNTING_MAPPING_MANAGE, module: 'accounting', description: 'Manage accounting mappings' },
  { code: PermissionCodes.ACCOUNTING_JOURNAL_VIEW, module: 'accounting', description: 'View journal entries' },
  { code: PermissionCodes.ACCOUNTING_JOURNAL_POST, module: 'accounting', description: 'Post journal entries' },
  { code: PermissionCodes.ACCOUNTING_JOURNAL_UNPOST, module: 'accounting', description: 'Unpost journal entries' },
  { code: PermissionCodes.ACCOUNTING_JOURNAL_REVERSE, module: 'accounting', description: 'Reverse posted journal entries' },
  { code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_VIEW, module: 'accounting', description: 'View manual operations' },
  { code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_CREATE, module: 'accounting', description: 'Create manual operations' },
  { code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_EDIT, module: 'accounting', description: 'Edit draft manual operations' },
  { code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_POST, module: 'accounting', description: 'Post manual operations' },
  { code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_UNPOST, module: 'accounting', description: 'Unpost manual operations' },
  { code: PermissionCodes.ACCOUNTING_OPENING_BALANCE_VIEW, module: 'accounting', description: 'View opening balances' },
  { code: PermissionCodes.ACCOUNTING_OPENING_BALANCE_MANAGE, module: 'accounting', description: 'Enter opening balances' },
  { code: PermissionCodes.ACCOUNTING_POSTING_HISTORY_VIEW, module: 'accounting', description: 'View posting run history' },
  { code: PermissionCodes.ACCOUNTING_TRIAL_BALANCE_VIEW, module: 'accounting', description: 'View the trial balance' },
  { code: PermissionCodes.ACCOUNTING_GENERAL_LEDGER_VIEW, module: 'accounting', description: 'View the general ledger' },

  { code: PermissionCodes.TAX_CONFIG_VIEW, module: 'tax', description: 'View tax configuration' },
  { code: PermissionCodes.TAX_RULE_VIEW, module: 'tax', description: 'View tax rules' },
  { code: PermissionCodes.TAX_RULE_CREATE, module: 'tax', description: 'Create tax rules' },
  { code: PermissionCodes.TAX_RULE_EDIT, module: 'tax', description: 'Edit tax rules' },
  { code: PermissionCodes.TAX_RULE_APPROVE, module: 'tax', description: 'Approve tax rules' },
  { code: PermissionCodes.TAX_RULE_ACTIVATE, module: 'tax', description: 'Activate tax rules' },
  { code: PermissionCodes.TAX_RATE_VIEW, module: 'tax', description: 'View tax rates' },
  { code: PermissionCodes.TAX_RATE_MANAGE, module: 'tax', description: 'Manage tax rates' },
  { code: PermissionCodes.TAX_CATEGORY_VIEW, module: 'tax', description: 'View tax categories' },
  { code: PermissionCodes.TAX_CATEGORY_MANAGE, module: 'tax', description: 'Manage tax categories' },
  { code: PermissionCodes.TAX_REGISTRATION_VIEW, module: 'tax', description: 'View tax registrations' },
  { code: PermissionCodes.TAX_REGISTRATION_MANAGE, module: 'tax', description: 'Manage tax registrations' },
  { code: PermissionCodes.TAX_MAPPING_VIEW, module: 'tax', description: 'View tax accounting mappings' },
  { code: PermissionCodes.TAX_MAPPING_MANAGE, module: 'tax', description: 'Manage tax accounting mappings' },
  { code: PermissionCodes.TAX_LEGAL_SOURCE_VIEW, module: 'tax', description: 'View tax legal sources' },
  { code: PermissionCodes.TAX_LEGAL_SOURCE_MANAGE, module: 'tax', description: 'Manage tax legal sources' },
  { code: PermissionCodes.TAX_CALCULATION_VIEW, module: 'tax', description: 'Preview/calculate tax' },
  { code: PermissionCodes.TAX_REGISTER_VIEW, module: 'tax', description: 'View the tax register' },
  { code: PermissionCodes.TAX_OVERRIDE, module: 'tax', description: 'Override a calculated tax amount' },
  { code: PermissionCodes.TAX_PERIOD_VIEW, module: 'tax', description: 'View tax periods' },
  { code: PermissionCodes.TAX_PERIOD_MANAGE, module: 'tax', description: 'Manage tax periods' },
];
