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
  PERIODS_REOPEN_REQUEST: 'periods.reopen_request.create',

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

  PRODUCT_PARENT_CATEGORY_VIEW: 'product_parent_category.view',
  PRODUCT_PARENT_CATEGORY_CREATE: 'product_parent_category.create',
  PRODUCT_PARENT_CATEGORY_EDIT: 'product_parent_category.edit',
  PRODUCT_PARENT_CATEGORY_DEACTIVATE: 'product_parent_category.deactivate',

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
  COUNTERPARTY_APPROVE: 'counterparty.approve',
  COUNTERPARTY_RISK_MANAGE: 'counterparty.risk.manage',

  // Counterparty contracts / amendments / documents ("Kontragentlər" module)
  CONTRACT_VIEW: 'contract.view',
  CONTRACT_CREATE: 'contract.create',
  CONTRACT_EDIT: 'contract.edit',
  CONTRACT_APPROVE: 'contract.approve',
  CONTRACT_AMENDMENT_CREATE: 'contract.amendment.create',
  CONTRACT_AMENDMENT_EDIT: 'contract.amendment.edit',
  CONTRACT_AMENDMENT_APPROVE: 'contract.amendment.approve',
  CONTRACT_DOCUMENT_MANAGE: 'contract.document.manage',

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
  ACCOUNTING_FINANCIAL_STATEMENTS_VIEW: 'accounting.financial_statements.view',

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

  // Sales Pre-Order & Order Management (docx spec Phase 6, section 100)
  SALES_CUSTOMER_REQUEST_VIEW: 'sales.customer_request.view',
  SALES_CUSTOMER_REQUEST_CREATE: 'sales.customer_request.create',
  SALES_CUSTOMER_REQUEST_EDIT: 'sales.customer_request.edit',
  SALES_CUSTOMER_REQUEST_CANCEL: 'sales.customer_request.cancel',
  SALES_OFFER_VIEW: 'sales.offer.view',
  SALES_OFFER_CREATE: 'sales.offer.create',
  SALES_OFFER_EDIT: 'sales.offer.edit',
  SALES_OFFER_SEND: 'sales.offer.send',
  SALES_OFFER_ACCEPT: 'sales.offer.accept',
  SALES_OFFER_CANCEL: 'sales.offer.cancel',
  SALES_OFFER_CONVERT: 'sales.offer.convert',
  SALES_ORDER_CONFIRM: 'sales.order.confirm',
  SALES_ORDER_CANCEL: 'sales.order.cancel',
  SALES_ORDER_REOPEN: 'sales.order.reopen',
  SALES_ORDER_APPROVE: 'sales.order.approve',
  SALES_ORDER_REJECT: 'sales.order.reject',
  SALES_PRICE_OVERRIDE: 'sales.price.override',
  SALES_DISCOUNT_OVERRIDE: 'sales.discount.override',
  SALES_CREDIT_OVERRIDE: 'sales.credit.override',
  SALES_RESERVATION_VIEW: 'sales.reservation.view',
  SALES_RESERVATION_MANAGE: 'sales.reservation.manage',
  SALES_SHIPMENT_PLAN_VIEW: 'sales.shipment_plan.view',
  SALES_SHIPMENT_PLAN_MANAGE: 'sales.shipment_plan.manage',
  SALES_PAYMENT_SCHEDULE_VIEW: 'sales.payment_schedule.view',
  SALES_FULFILLMENT_VIEW: 'sales.fulfillment.view',
  SALES_ORDER_HOLD_MANAGE: 'sales.order_hold.manage',

  // Sales Execution (docx spec Phase 7, section 84)
  SALES_SHIPMENT_VIEW: 'sales.shipment.view',
  SALES_SHIPMENT_CREATE: 'sales.shipment.create',
  SALES_SHIPMENT_EDIT: 'sales.shipment.edit',
  SALES_SHIPMENT_CANCEL: 'sales.shipment.cancel',
  SALES_INVOICE_REVERSE: 'sales.invoice.reverse',
  SALES_RETURN_VIEW: 'sales.return.view',
  SALES_RETURN_CREATE: 'sales.return.create',
  SALES_RETURN_EDIT: 'sales.return.edit',
  SALES_ACCOUNTING_ENTRIES_VIEW: 'sales.accounting_entries.view',
  SALES_TAX_DETAILS_VIEW: 'sales.tax_details.view',

  // Procurement & Purchase Order Management (docx spec Phase 8, section 92)
  PURCHASE_REQUIREMENT_VIEW: 'purchase.requirement.view',
  PURCHASE_REQUIREMENT_CREATE: 'purchase.requirement.create',
  PURCHASE_REQUIREMENT_EDIT: 'purchase.requirement.edit',
  PURCHASE_REQUIREMENT_CANCEL: 'purchase.requirement.cancel',
  PURCHASE_REQUIREMENT_APPROVE: 'purchase.requirement.approve',
  PURCHASE_REQUIREMENT_REJECT: 'purchase.requirement.reject',
  PURCHASE_ORDER_VIEW: 'purchase.order.view',
  PURCHASE_ORDER_CREATE: 'purchase.order.create',
  PURCHASE_ORDER_EDIT: 'purchase.order.edit',
  PURCHASE_ORDER_APPROVE: 'purchase.order.approve',
  PURCHASE_ORDER_REJECT: 'purchase.order.reject',
  PURCHASE_ORDER_CONFIRM: 'purchase.order.confirm',
  PURCHASE_ORDER_REOPEN: 'purchase.order.reopen',
  PURCHASE_ORDER_CANCEL: 'purchase.order.cancel',
  PURCHASE_PRICE_OVERRIDE: 'purchase.price.override',
  PURCHASE_SUPPLIER_SELECTION_VIEW: 'purchase.supplier_selection.view',
  PURCHASE_SUPPLIER_SELECTION_MANAGE: 'purchase.supplier_selection.manage',
  PURCHASE_EXPECTED_RECEIPT_VIEW: 'purchase.expected_receipt.view',
  PURCHASE_PAYMENT_SCHEDULE_VIEW: 'purchase.payment_schedule.view',
  PURCHASE_PAYMENT_SCHEDULE_MANAGE: 'purchase.payment_schedule.manage',
  PURCHASE_SUPPLY_PLANNING_VIEW: 'purchase.supply_planning.view',
  PURCHASE_SUPPLY_PEGGING_MANAGE: 'purchase.supply_pegging.manage',
  PURCHASE_ORDER_HOLD_MANAGE: 'purchase.order_hold.manage',
  PURCHASE_SUPPLIER_PRODUCT_CODE_VIEW: 'purchase.supplier_product_code.view',
  PURCHASE_SUPPLIER_PRODUCT_CODE_MANAGE:
    'purchase.supplier_product_code.manage',

  // Purchase Execution (docx spec Phase 9, section 37) — Goods Receipt,
  // Purchase Invoice, Purchase Return, Additional Purchase Cost. Confirm
  // /reopen/cancel reuse the generic documents.post/unpost/cancel
  // permissions on /documents/<TYPE>/:id/... like every other document
  // type in this codebase (PURCHASE_POST/UNPOST/CANCEL from the spec's
  // own list are intentionally not duplicated here).
  PURCHASE_VIEW: 'purchase_execution.view',
  PURCHASE_CREATE: 'purchase_execution.create',
  PURCHASE_EDIT: 'purchase_execution.edit',
  PURCHASE_RETURN: 'purchase_execution.return',
  PURCHASE_VIEW_ACCOUNTING: 'purchase_execution.view_accounting',
  // Approval workflow increment 2 (docs/APPROVALS.md): price/tax
  // visibility gate on Goods Receipt, plus approve/reject for the
  // over-delivery (WAREHOUSE_SUPERVISOR) and price-variance (ACCOUNTING)
  // approval steps.
  PURCHASE_PRICE_VIEW: 'purchase_execution.price_view',
  PURCHASE_RECEIPT_APPROVE: 'purchase_execution.receipt.approve',
  PURCHASE_RECEIPT_REJECT: 'purchase_execution.receipt.reject',
  PURCHASE_INVOICE_APPROVE: 'purchase_execution.invoice.approve',
  PURCHASE_INVOICE_REJECT: 'purchase_execution.invoice.reject',

  // Treasury / payment chain (docs/APPROVALS.md)
  PAYMENT_REQUEST_VIEW: 'treasury.payment_request.view',
  PAYMENT_REQUEST_CREATE: 'treasury.payment_request.create',
  PAYMENT_REQUEST_CANCEL: 'treasury.payment_request.cancel',
  PAYMENT_ORDER_VIEW: 'treasury.payment_order.view',
  PAYMENT_ORDER_CREATE: 'treasury.payment_order.create',
  PAYMENT_ORDER_EDIT: 'treasury.payment_order.edit',
  PAYMENT_ORDER_APPROVE: 'treasury.payment_order.approve',
  PAYMENT_ORDER_REJECT: 'treasury.payment_order.reject',
  PAYMENT_ORDER_RECONCILE: 'treasury.payment_order.reconcile',
  CASH_TRANSACTION_VIEW: 'treasury.cash_transaction.view',
  CASH_TRANSACTION_CREATE: 'treasury.cash_transaction.create',
  CASH_TRANSACTION_EDIT: 'treasury.cash_transaction.edit',
  TREASURY_RECONCILIATION_VIEW: 'treasury.reconciliation.view',
  TREASURY_RECONCILIATION_MANAGE: 'treasury.reconciliation.manage',
  BANK_VIEW: 'bank.view',
  BANK_CREATE: 'bank.create',
  BANK_EDIT: 'bank.edit',
  BANK_DEACTIVATE: 'bank.deactivate',
  CASH_FLOW_VIEW: 'treasury.cash_flow.view',

  // Treasury / Bank Operations build (docx spec Phase 14)
  PAYMENT_REQUEST_APPROVE: 'treasury.payment_request.approve',
  TREASURY_VIEW_LIQUIDITY: 'treasury.liquidity.view',
  TREASURY_LIQUIDITY_POLICY_MANAGE: 'treasury.liquidity_policy.manage',
  TREASURY_APPROVAL_RULE_MANAGE: 'treasury.approval_rule.manage',
  INCOMING_BANK_PAYMENT_VIEW: 'treasury.incoming_bank_payment.view',
  INCOMING_BANK_PAYMENT_CREATE: 'treasury.incoming_bank_payment.create',
  INCOMING_BANK_PAYMENT_EDIT: 'treasury.incoming_bank_payment.edit',
  INTERNAL_BANK_TRANSFER_VIEW: 'treasury.internal_transfer.view',
  INTERNAL_BANK_TRANSFER_CREATE: 'treasury.internal_transfer.create',
  BANK_FEE_VIEW: 'treasury.bank_fee.view',
  BANK_FEE_CREATE: 'treasury.bank_fee.create',
  FX_CONVERSION_VIEW: 'treasury.fx_conversion.view',
  FX_CONVERSION_CREATE: 'treasury.fx_conversion.create',
  BANK_RECONCILIATION_MANAGE: 'treasury.bank_reconciliation.manage',
  BANK_RECONCILIATION_CLOSE: 'treasury.bank_reconciliation.close',
  BANK_RECONCILIATION_REOPEN: 'treasury.bank_reconciliation.reopen',
  TREASURY_HEALTH_VIEW: 'treasury.health.view',

  // Cash Desk Engine (docx spec Phase 15)
  CASH_VIEW: 'cash_desk.view',
  CASH_VIEW_BALANCE: 'cash_desk.view_balance',
  CASH_RECEIPT_CREATE: 'cash_desk.receipt.create',
  CASH_RECEIPT_POST: 'cash_desk.receipt.post',
  CASH_EXPENSE_CREATE: 'cash_desk.expense.create',
  CASH_EXPENSE_POST: 'cash_desk.expense.post',
  CASH_TRANSFER_CREATE: 'cash_desk.transfer.create',
  CASH_TRANSFER_POST: 'cash_desk.transfer.post',
  CASH_TRANSFER_RECEIVE: 'cash_desk.transfer.receive',
  CASH_COUNT: 'cash_desk.physical_count.manage',
  CASH_DAILY_CLOSE: 'cash_desk.daily_close.manage',
  CASH_DAILY_CLOSE_REOPEN: 'cash_desk.daily_close.reopen',
  CASH_ADJUSTMENT_CREATE: 'cash_desk.adjustment.create',
  CASH_ADJUSTMENT_APPROVE: 'cash_desk.adjustment.approve',
  CASH_VIEW_OTHER_CASHIERS: 'cash_desk.view_other_cashiers',
  CASH_OVERRIDE_NEGATIVE: 'cash_desk.override_negative_balance',
  CASH_VIEW_ACCOUNTING: 'cash_desk.view_accounting',
  CASH_PERIOD_OVERRIDE: 'cash_desk.period_override',
  CASHIER_ASSIGNMENT_MANAGE: 'cash_desk.cashier_assignment.manage',
  CASH_DENOMINATION_MANAGE: 'cash_desk.denomination.manage',
  CASHIER_HANDOVER_MANAGE: 'cash_desk.handover.manage',

  // Fixed Asset Subledger (docx spec Phase 16)
  FIXED_ASSET_VIEW: 'fixed_asset.view',
  FIXED_ASSET_VIEW_COST: 'fixed_asset.view_cost',
  FIXED_ASSET_CREATE: 'fixed_asset.create',
  FIXED_ASSET_ACCEPT: 'fixed_asset.accept',
  FIXED_ASSET_COMMISSION: 'fixed_asset.commission',
  FIXED_ASSET_TRANSFER: 'fixed_asset.transfer',
  FIXED_ASSET_MODERNIZE: 'fixed_asset.modernize',
  FIXED_ASSET_CHANGE_USEFUL_LIFE: 'fixed_asset.change_useful_life',
  FIXED_ASSET_DEPRECIATION_CALCULATE: 'fixed_asset.depreciation.calculate',
  FIXED_ASSET_DEPRECIATION_POST: 'fixed_asset.depreciation.post',
  FIXED_ASSET_IMPAIR: 'fixed_asset.impair',
  FIXED_ASSET_REVALUE: 'fixed_asset.revalue',
  FIXED_ASSET_INVENTORY: 'fixed_asset.inventory',
  FIXED_ASSET_DISPOSE: 'fixed_asset.dispose',
  FIXED_ASSET_WRITE_OFF: 'fixed_asset.write_off',
  FIXED_ASSET_MANUAL_ADJUSTMENT: 'fixed_asset.manual_adjustment',
  FIXED_ASSET_VIEW_ACCOUNTING: 'fixed_asset.view_accounting',
  FIXED_ASSET_PERIOD_OVERRIDE: 'fixed_asset.period_override',

  // HR Core / Employment Lifecycle Engine (docx spec Phase 17)
  HR_PERSON_VIEW: 'hr.person.view',
  HR_PERSON_CREATE: 'hr.person.create',
  HR_PERSON_EDIT: 'hr.person.edit',
  HR_EMPLOYEE_VIEW: 'hr.employee.view',
  HR_EMPLOYEE_CREATE: 'hr.employee.create',
  HR_EMPLOYMENT_CREATE: 'hr.employment.create',
  HR_HIRE_CREATE: 'hr.hire.create',
  HR_HIRE_POST: 'hr.hire.post',
  HR_HIRE_APPROVE: 'hr.hire.approve',
  HR_HIRE_REJECT: 'hr.hire.reject',
  HR_TRANSFER_CREATE: 'hr.transfer.create',
  HR_TRANSFER_POST: 'hr.transfer.post',
  HR_TRANSFER_APPROVE: 'hr.transfer.approve',
  HR_TRANSFER_REJECT: 'hr.transfer.reject',
  HR_TERMINATE_CREATE: 'hr.terminate.create',
  HR_TERMINATE_POST: 'hr.terminate.post',
  HR_TERMINATE_APPROVE: 'hr.terminate.approve',
  HR_TERMINATE_REJECT: 'hr.terminate.reject',
  HR_CONTRACT_VIEW: 'hr.contract.view',
  HR_CONTRACT_EDIT: 'hr.contract.edit',
  HR_STAFFING_VIEW: 'hr.staffing.view',
  HR_STAFFING_EDIT: 'hr.staffing.edit',
  HR_LEAVE_VIEW: 'hr.leave.view',
  HR_LEAVE_CREATE: 'hr.leave.create',
  HR_ABSENCE_VIEW: 'hr.absence.view',
  HR_ABSENCE_CREATE: 'hr.absence.create',
  HR_VIEW_PERSONAL_DATA: 'hr.view_personal_data',
  HR_VIEW_SENSITIVE_DATA: 'hr.view_sensitive_data',
  HR_VIEW_HISTORY: 'hr.view_history',
  HR_OVERRIDE_STAFFING_LIMIT: 'hr.override_staffing_limit',
  HR_REPORT_VIEW: 'hr.report.view',

  // Work Time / Timesheet Engine (docx spec Phase 18)
  TIME_VIEW: 'time.view',
  TIME_VIEW_OWN: 'time.view_own',
  TIME_VIEW_DEPARTMENT: 'time.view_department',
  TIME_CALENDAR_EDIT: 'time.calendar.edit',
  TIME_SCHEDULE_EDIT: 'time.schedule.edit',
  TIME_ATTENDANCE_IMPORT: 'time.attendance.import',
  TIME_ATTENDANCE_EDIT: 'time.attendance.edit',
  TIME_TIMESHEET_CREATE: 'time.timesheet.create',
  TIME_TIMESHEET_EDIT: 'time.timesheet.edit',
  TIME_TIMESHEET_APPROVE: 'time.timesheet.approve',
  TIME_TIMESHEET_LOCK: 'time.timesheet.lock',
  TIME_TIMESHEET_REOPEN: 'time.timesheet.reopen',
  TIME_OVERTIME_CREATE: 'time.overtime.create',
  TIME_OVERTIME_APPROVE: 'time.overtime.approve',
  TIME_CORRECTION_CREATE: 'time.correction.create',
  TIME_CORRECTION_APPROVE: 'time.correction.approve',
  TIME_VIEW_PAYROLL_INPUT: 'time.view_payroll_input',
  TIME_OVERRIDE_VALIDATION: 'time.override_validation',

  // Payroll / Gross-to-Net Engine (docx spec Phase 19)
  PAYROLL_VIEW: 'payroll.view',
  PAYROLL_VIEW_OWN: 'payroll.view_own',
  PAYROLL_VIEW_DEPARTMENT: 'payroll.view_department',
  PAYROLL_VIEW_SALARY: 'payroll.view_salary',
  PAYROLL_EDIT_COMPENSATION: 'payroll.edit_compensation',
  PAYROLL_CREATE_VARIABLE_INPUT: 'payroll.create_variable_input',
  PAYROLL_CALCULATE: 'payroll.calculate',
  PAYROLL_RECALCULATE: 'payroll.recalculate',
  PAYROLL_APPROVE: 'payroll.approve',
  PAYROLL_POST: 'payroll.post',
  PAYROLL_CLOSE: 'payroll.close',
  PAYROLL_REOPEN: 'payroll.reopen',
  PAYROLL_CREATE_PAYMENT_BATCH: 'payroll.create_payment_batch',
  PAYROLL_VIEW_TAX: 'payroll.view_tax',
  PAYROLL_EDIT_TAX_PROFILE: 'payroll.edit_tax_profile',
  PAYROLL_MANAGE_DEDUCTIONS: 'payroll.manage_deductions',
  PAYROLL_MANUAL_ADJUSTMENT: 'payroll.manual_adjustment',
  PAYROLL_VIEW_ACCOUNTING: 'payroll.view_accounting',
  PAYROLL_VIEW_LEGAL_TRACE: 'payroll.view_legal_trace',

  // Expenses / Cost Centers / Employee Expenses (docx spec Phase 20)
  EXPENSE_VIEW: 'expense.view',
  EXPENSE_VIEW_OWN: 'expense.view_own',
  EXPENSE_VIEW_DEPARTMENT: 'expense.view_department',
  EXPENSE_CLAIM_CREATE: 'expense.claim_create',
  EXPENSE_CLAIM_SUBMIT: 'expense.claim_submit',
  EXPENSE_CLAIM_APPROVE: 'expense.claim_approve',
  EXPENSE_CLAIM_POST: 'expense.claim_post',
  EXPENSE_RECEIPT_REVIEW: 'expense.receipt_review',
  EXPENSE_POLICY_OVERRIDE: 'expense.policy_override',
  EXPENSE_TAX_OVERRIDE: 'expense.tax_override',
  EXPENSE_ALLOCATION_EDIT: 'expense.allocation_edit',
  EXPENSE_ALLOCATION_RUN: 'expense.allocation_run',
  EXPENSE_PREPAID_CREATE: 'expense.prepaid_create',
  EXPENSE_PREPAID_ADJUST: 'expense.prepaid_adjust',
  EXPENSE_RECLASSIFY: 'expense.reclassify',
  EXPENSE_VIEW_EMPLOYEE_BALANCE: 'expense.view_employee_balance',
  EXPENSE_VIEW_COST_CENTER: 'expense.view_cost_center',
  EXPENSE_VIEW_ACCOUNTING: 'expense.view_accounting',
  EXPENSE_PERIOD_REOPEN: 'expense.period_reopen',
  EXPENSE_MANAGE_CATALOG: 'expense.manage_catalog',
  EXPENSE_MANAGE_BUDGET: 'expense.manage_budget',

  // Warehouse / Stock Engine (docx spec Phase 10, section 65)
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_VIEW_ALL_WAREHOUSES: 'inventory.view_all_warehouses',
  INVENTORY_TRANSFER_CREATE: 'inventory.transfer.create',
  INVENTORY_TRANSFER_POST: 'inventory.transfer.post',
  INVENTORY_TRANSFER_RECEIVE: 'inventory.transfer.receive',
  INVENTORY_INTERNAL_MOVE: 'inventory.internal_move',
  INVENTORY_CONSUME: 'inventory.consume',
  INVENTORY_WRITE_OFF: 'inventory.write_off',
  INVENTORY_WRITE_OFF_APPROVE: 'inventory.write_off.approve',
  INVENTORY_STATUS_CHANGE: 'inventory.status_change',
  INVENTORY_RESERVE: 'inventory.reserve',
  INVENTORY_RELEASE_RESERVATION: 'inventory.release_reservation',
  INVENTORY_OVERRIDE_NEGATIVE: 'inventory.override_negative',
  INVENTORY_VIEW_SERIAL_HISTORY: 'inventory.view_serial_history',
  INVENTORY_VIEW_MOVEMENTS: 'inventory.view_movements',
  INVENTORY_UNPOST: 'inventory.unpost',
  INVENTORY_PERIOD_OVERRIDE: 'inventory.period_override',
  INVENTORY_MANUAL_ADJUSTMENT: 'inventory.manual_adjustment',

  // Inventory Costing Engine (docx spec Phase 11, section 97)
  INVENTORY_COST_VIEW: 'inventory_cost.view',
  INVENTORY_COST_VIEW_LAYERS: 'inventory_cost.view_layers',
  INVENTORY_COST_RECALCULATE: 'inventory_cost.recalculate',
  INVENTORY_COST_FINALIZE: 'inventory_cost.finalize',
  INVENTORY_COST_REOPEN: 'inventory_cost.reopen',
  INVENTORY_COST_ADJUST: 'inventory_cost.adjust',
  INVENTORY_COST_MANUAL_OVERRIDE: 'inventory_cost.manual_override',
  INVENTORY_COST_VIEW_ERRORS: 'inventory_cost.view_errors',
  INVENTORY_COST_VIEW_COGS: 'inventory_cost.view_cogs',
  INVENTORY_COST_VIEW_ACCOUNTING: 'inventory_cost.view_accounting',
  INVENTORY_COST_POLICY_MANAGE: 'inventory_cost.policy_manage',

  // Inventory Count / Reconciliation Engine (docx spec Phase 12)
  INVENTORY_COUNT_VIEW: 'inventory_count.view',
  INVENTORY_COUNT_PLAN: 'inventory_count.plan',
  INVENTORY_COUNT_MANAGE_SCOPE: 'inventory_count.manage_scope',
  INVENTORY_COUNT_START_SESSION: 'inventory_count.start_session',
  INVENTORY_COUNT_ENTER: 'inventory_count.enter',
  INVENTORY_COUNT_VIEW_ACCOUNTING_QUANTITY:
    'inventory_count.view_accounting_quantity',
  INVENTORY_COUNT_RECOUNT: 'inventory_count.recount',
  INVENTORY_COUNT_DECIDE_VARIANCE: 'inventory_count.decide_variance',
  INVENTORY_COUNT_APPROVE: 'inventory_count.approve',
  INVENTORY_COUNT_POST_ADJUSTMENTS: 'inventory_count.post_adjustments',
  INVENTORY_COUNT_RECONCILE: 'inventory_count.reconcile',
  INVENTORY_COUNT_CLOSE: 'inventory_count.close',
  INVENTORY_COUNT_CANCEL: 'inventory_count.cancel',

  // Counterparty Settlement Engine (docx spec Phase 13)
  SETTLEMENT_VIEW: 'settlement.view',
  SETTLEMENT_VIEW_ALL: 'settlement.view_all',
  SETTLEMENT_ALLOCATE: 'settlement.allocate',
  SETTLEMENT_AUTO_ALLOCATE: 'settlement.auto_allocate',
  SETTLEMENT_REVERSE_ALLOCATION: 'settlement.reverse_allocation',
  SETTLEMENT_APPLY_ADVANCE: 'settlement.apply_advance',
  SETTLEMENT_CREATE_ADJUSTMENT: 'settlement.create_adjustment',
  SETTLEMENT_APPROVE_ADJUSTMENT: 'settlement.approve_adjustment',
  SETTLEMENT_WRITE_OFF: 'settlement.write_off',
  SETTLEMENT_OFFSET: 'settlement.offset',
  SETTLEMENT_RECONCILE: 'settlement.reconcile',
  SETTLEMENT_VIEW_FX: 'settlement.view_fx',
  SETTLEMENT_OVERRIDE_FX: 'settlement.override_fx',
  SETTLEMENT_VIEW_ACCOUNTING: 'settlement.view_accounting',
  SETTLEMENT_OVERRIDE_CONTRACT: 'settlement.override_contract',
  SETTLEMENT_PERIOD_OVERRIDE: 'settlement.period_override',
} as const;

export const ALL_PERMISSION_CODES: {
  code: string;
  module: string;
  description: string;
}[] = [
  {
    code: PermissionCodes.CORE_USERS_VIEW,
    module: 'core',
    description: 'View users in the tenant',
  },
  {
    code: PermissionCodes.CORE_USERS_MANAGE,
    module: 'core',
    description: 'Manage tenant memberships',
  },
  {
    code: PermissionCodes.CORE_ROLES_VIEW,
    module: 'core',
    description: 'View roles and permissions',
  },
  {
    code: PermissionCodes.CORE_ROLES_MANAGE,
    module: 'core',
    description: 'Manage roles and role permissions',
  },
  {
    code: PermissionCodes.CORE_TENANT_MANAGE,
    module: 'core',
    description: 'Manage tenant-level configuration',
  },
  {
    code: PermissionCodes.CORE_SETTINGS_VIEW,
    module: 'core',
    description: 'View scoped settings',
  },
  {
    code: PermissionCodes.CORE_SETTINGS_MANAGE,
    module: 'core',
    description: 'Manage scoped settings',
  },

  {
    code: PermissionCodes.DOCUMENTS_VIEW,
    module: 'documents',
    description: 'View documents',
  },
  {
    code: PermissionCodes.DOCUMENTS_CREATE,
    module: 'documents',
    description: 'Create documents',
  },
  {
    code: PermissionCodes.DOCUMENTS_EDIT,
    module: 'documents',
    description: 'Edit documents',
  },
  {
    code: PermissionCodes.DOCUMENTS_DELETE,
    module: 'documents',
    description: 'Mark documents for deletion',
  },
  {
    code: PermissionCodes.DOCUMENTS_POST,
    module: 'documents',
    description: 'Post documents',
  },
  {
    code: PermissionCodes.DOCUMENTS_UNPOST,
    module: 'documents',
    description: 'Unpost documents',
  },
  {
    code: PermissionCodes.DOCUMENTS_CANCEL,
    module: 'documents',
    description: 'Cancel documents',
  },

  {
    code: PermissionCodes.PERIODS_VIEW,
    module: 'periods',
    description: 'View accounting periods',
  },
  {
    code: PermissionCodes.PERIODS_CLOSE,
    module: 'periods',
    description: 'Close accounting periods',
  },
  {
    code: PermissionCodes.PERIODS_REOPEN,
    module: 'periods',
    description: 'Reopen accounting periods',
  },
  {
    code: PermissionCodes.PERIODS_REOPEN_REQUEST,
    module: 'periods',
    description: 'Request that a closed accounting period be reopened',
  },

  {
    code: PermissionCodes.AUDIT_VIEW,
    module: 'audit',
    description: 'View audit events',
  },

  {
    code: PermissionCodes.CURRENCY_MANAGE,
    module: 'currency',
    description: 'Manage currencies and exchange rates',
  },
  {
    code: PermissionCodes.NUMBERING_MANAGE,
    module: 'numbering',
    description: 'Manage numbering sequences',
  },

  {
    code: PermissionCodes.ORGANIZATION_VIEW,
    module: 'organization',
    description: 'View organizations',
  },
  {
    code: PermissionCodes.ORGANIZATION_CREATE,
    module: 'organization',
    description: 'Create organizations',
  },
  {
    code: PermissionCodes.ORGANIZATION_EDIT,
    module: 'organization',
    description: 'Edit organizations',
  },
  {
    code: PermissionCodes.ORGANIZATION_DEACTIVATE,
    module: 'organization',
    description: 'Deactivate organizations',
  },

  {
    code: PermissionCodes.BRANCH_VIEW,
    module: 'branch',
    description: 'View branches',
  },
  {
    code: PermissionCodes.BRANCH_CREATE,
    module: 'branch',
    description: 'Create branches',
  },
  {
    code: PermissionCodes.BRANCH_EDIT,
    module: 'branch',
    description: 'Edit branches',
  },
  {
    code: PermissionCodes.BRANCH_DEACTIVATE,
    module: 'branch',
    description: 'Deactivate branches',
  },

  {
    code: PermissionCodes.DEPARTMENT_VIEW,
    module: 'department',
    description: 'View departments',
  },
  {
    code: PermissionCodes.DEPARTMENT_CREATE,
    module: 'department',
    description: 'Create departments',
  },
  {
    code: PermissionCodes.DEPARTMENT_EDIT,
    module: 'department',
    description: 'Edit departments',
  },
  {
    code: PermissionCodes.DEPARTMENT_DEACTIVATE,
    module: 'department',
    description: 'Deactivate departments',
  },

  {
    code: PermissionCodes.RESPONSIBLE_PERSON_VIEW,
    module: 'responsible_person',
    description: 'View responsible persons',
  },
  {
    code: PermissionCodes.RESPONSIBLE_PERSON_MANAGE,
    module: 'responsible_person',
    description: 'Manage responsible persons',
  },

  {
    code: PermissionCodes.WAREHOUSE_VIEW,
    module: 'warehouse',
    description: 'View warehouses',
  },
  {
    code: PermissionCodes.WAREHOUSE_CREATE,
    module: 'warehouse',
    description: 'Create warehouses',
  },
  {
    code: PermissionCodes.WAREHOUSE_EDIT,
    module: 'warehouse',
    description: 'Edit warehouses',
  },
  {
    code: PermissionCodes.WAREHOUSE_DEACTIVATE,
    module: 'warehouse',
    description: 'Deactivate warehouses',
  },

  {
    code: PermissionCodes.CASHBOX_VIEW,
    module: 'cashbox',
    description: 'View cashboxes',
  },
  {
    code: PermissionCodes.CASHBOX_CREATE,
    module: 'cashbox',
    description: 'Create cashboxes',
  },
  {
    code: PermissionCodes.CASHBOX_EDIT,
    module: 'cashbox',
    description: 'Edit cashboxes',
  },
  {
    code: PermissionCodes.CASHBOX_DEACTIVATE,
    module: 'cashbox',
    description: 'Deactivate cashboxes',
  },

  {
    code: PermissionCodes.BANK_ACCOUNT_VIEW,
    module: 'bank_account',
    description: 'View bank accounts',
  },
  {
    code: PermissionCodes.BANK_ACCOUNT_CREATE,
    module: 'bank_account',
    description: 'Create bank accounts',
  },
  {
    code: PermissionCodes.BANK_ACCOUNT_EDIT,
    module: 'bank_account',
    description: 'Edit bank accounts',
  },
  {
    code: PermissionCodes.BANK_ACCOUNT_DEACTIVATE,
    module: 'bank_account',
    description: 'Deactivate bank accounts',
  },

  {
    code: PermissionCodes.ACCOUNTING_POLICY_VIEW,
    module: 'accounting_policy',
    description: 'View accounting policies',
  },
  {
    code: PermissionCodes.ACCOUNTING_POLICY_MANAGE,
    module: 'accounting_policy',
    description: 'Manage accounting policies',
  },

  {
    code: PermissionCodes.TAX_PROFILE_VIEW,
    module: 'tax_profile',
    description: 'View tax profiles',
  },
  {
    code: PermissionCodes.TAX_PROFILE_MANAGE,
    module: 'tax_profile',
    description: 'Manage tax profiles',
  },

  {
    code: PermissionCodes.ORGANIZATION_ACCESS_MANAGE,
    module: 'organization_access',
    description: 'Grant/revoke organization access',
  },

  {
    code: PermissionCodes.UNIT_OF_MEASURE_VIEW,
    module: 'unit_of_measure',
    description: 'View units of measure',
  },
  {
    code: PermissionCodes.UNIT_OF_MEASURE_CREATE,
    module: 'unit_of_measure',
    description: 'Create units of measure',
  },
  {
    code: PermissionCodes.UNIT_OF_MEASURE_EDIT,
    module: 'unit_of_measure',
    description: 'Edit units of measure',
  },
  {
    code: PermissionCodes.UNIT_OF_MEASURE_DEACTIVATE,
    module: 'unit_of_measure',
    description: 'Deactivate units of measure',
  },

  {
    code: PermissionCodes.PRODUCT_PARENT_CATEGORY_VIEW,
    module: 'product_parent_category',
    description: 'View parent categories (üst kateqoriya)',
  },
  {
    code: PermissionCodes.PRODUCT_PARENT_CATEGORY_CREATE,
    module: 'product_parent_category',
    description: 'Create parent categories (üst kateqoriya)',
  },
  {
    code: PermissionCodes.PRODUCT_PARENT_CATEGORY_EDIT,
    module: 'product_parent_category',
    description: 'Edit parent categories (üst kateqoriya)',
  },
  {
    code: PermissionCodes.PRODUCT_PARENT_CATEGORY_DEACTIVATE,
    module: 'product_parent_category',
    description: 'Deactivate parent categories (üst kateqoriya)',
  },
  {
    code: PermissionCodes.PRODUCT_CATEGORY_VIEW,
    module: 'product_category',
    description: 'View product categories',
  },
  {
    code: PermissionCodes.PRODUCT_CATEGORY_CREATE,
    module: 'product_category',
    description: 'Create product categories',
  },
  {
    code: PermissionCodes.PRODUCT_CATEGORY_EDIT,
    module: 'product_category',
    description: 'Edit product categories',
  },
  {
    code: PermissionCodes.PRODUCT_CATEGORY_DEACTIVATE,
    module: 'product_category',
    description: 'Deactivate product categories',
  },

  {
    code: PermissionCodes.PRODUCT_VIEW,
    module: 'product',
    description: 'View products',
  },
  {
    code: PermissionCodes.PRODUCT_CREATE,
    module: 'product',
    description: 'Create products',
  },
  {
    code: PermissionCodes.PRODUCT_EDIT,
    module: 'product',
    description: 'Edit products',
  },
  {
    code: PermissionCodes.PRODUCT_DEACTIVATE,
    module: 'product',
    description: 'Deactivate products',
  },

  {
    code: PermissionCodes.UNIT_CONVERSION_VIEW,
    module: 'unit_conversion',
    description: 'View unit conversions',
  },
  {
    code: PermissionCodes.UNIT_CONVERSION_CREATE,
    module: 'unit_conversion',
    description: 'Create unit conversions',
  },
  {
    code: PermissionCodes.UNIT_CONVERSION_EDIT,
    module: 'unit_conversion',
    description: 'Edit unit conversions',
  },
  {
    code: PermissionCodes.UNIT_CONVERSION_DEACTIVATE,
    module: 'unit_conversion',
    description: 'Deactivate unit conversions',
  },

  {
    code: PermissionCodes.COUNTERPARTY_VIEW,
    module: 'counterparty',
    description: 'View counterparties',
  },
  {
    code: PermissionCodes.COUNTERPARTY_CREATE,
    module: 'counterparty',
    description: 'Create counterparties',
  },
  {
    code: PermissionCodes.COUNTERPARTY_EDIT,
    module: 'counterparty',
    description: 'Edit counterparties',
  },
  {
    code: PermissionCodes.COUNTERPARTY_DEACTIVATE,
    module: 'counterparty',
    description: 'Deactivate counterparties',
  },
  {
    code: PermissionCodes.COUNTERPARTY_APPROVE,
    module: 'counterparty',
    description: 'Approve counterparties',
  },
  {
    code: PermissionCodes.COUNTERPARTY_RISK_MANAGE,
    module: 'counterparty',
    description: 'Set a counterparty risk status (watch/blacklist)',
  },

  {
    code: PermissionCodes.CONTRACT_VIEW,
    module: 'contract',
    description: 'View counterparty contracts',
  },
  {
    code: PermissionCodes.CONTRACT_CREATE,
    module: 'contract',
    description: 'Create counterparty contracts',
  },
  {
    code: PermissionCodes.CONTRACT_EDIT,
    module: 'contract',
    description: 'Edit counterparty contracts',
  },
  {
    code: PermissionCodes.CONTRACT_APPROVE,
    module: 'contract',
    description: 'Approve counterparty contracts',
  },
  {
    code: PermissionCodes.CONTRACT_AMENDMENT_CREATE,
    module: 'contract',
    description: 'Create contract amendments',
  },
  {
    code: PermissionCodes.CONTRACT_AMENDMENT_EDIT,
    module: 'contract',
    description: 'Edit contract amendments',
  },
  {
    code: PermissionCodes.CONTRACT_AMENDMENT_APPROVE,
    module: 'contract',
    description: 'Approve contract amendments',
  },
  {
    code: PermissionCodes.CONTRACT_DOCUMENT_MANAGE,
    module: 'contract',
    description: 'Upload/download/delete contract and amendment documents',
  },

  {
    code: PermissionCodes.PRICE_LIST_VIEW,
    module: 'price_list',
    description: 'View price lists',
  },
  {
    code: PermissionCodes.PRICE_LIST_CREATE,
    module: 'price_list',
    description: 'Create price lists',
  },
  {
    code: PermissionCodes.PRICE_LIST_EDIT,
    module: 'price_list',
    description: 'Edit price lists',
  },
  {
    code: PermissionCodes.PRICE_LIST_DEACTIVATE,
    module: 'price_list',
    description: 'Deactivate price lists',
  },

  {
    code: PermissionCodes.PRODUCT_PRICE_VIEW,
    module: 'product_price',
    description: 'View product prices',
  },
  {
    code: PermissionCodes.PRODUCT_PRICE_MANAGE,
    module: 'product_price',
    description: 'Manage product prices',
  },

  {
    code: PermissionCodes.SALES_ORDER_VIEW,
    module: 'sales_order',
    description: 'View sales orders',
  },
  {
    code: PermissionCodes.SALES_ORDER_CREATE,
    module: 'sales_order',
    description: 'Create sales orders',
  },
  {
    code: PermissionCodes.SALES_ORDER_EDIT,
    module: 'sales_order',
    description: 'Edit sales orders',
  },

  {
    code: PermissionCodes.SALES_INVOICE_VIEW,
    module: 'sales_invoice',
    description: 'View sales invoices',
  },
  {
    code: PermissionCodes.SALES_INVOICE_CREATE,
    module: 'sales_invoice',
    description: 'Create sales invoices',
  },
  {
    code: PermissionCodes.SALES_INVOICE_EDIT,
    module: 'sales_invoice',
    description: 'Edit sales invoices',
  },

  {
    code: PermissionCodes.ACCOUNTING_CHART_VIEW,
    module: 'accounting',
    description: 'View the chart of accounts',
  },
  {
    code: PermissionCodes.ACCOUNTING_CHART_MANAGE,
    module: 'accounting',
    description: 'Adopt/manage charts of accounts',
  },
  {
    code: PermissionCodes.ACCOUNTING_ACCOUNT_VIEW,
    module: 'accounting',
    description: 'View accounts',
  },
  {
    code: PermissionCodes.ACCOUNTING_ACCOUNT_CREATE,
    module: 'accounting',
    description: 'Create accounts/subaccounts',
  },
  {
    code: PermissionCodes.ACCOUNTING_ACCOUNT_EDIT,
    module: 'accounting',
    description: 'Edit accounts',
  },
  {
    code: PermissionCodes.ACCOUNTING_ACCOUNT_DEACTIVATE,
    module: 'accounting',
    description: 'Deactivate accounts',
  },
  {
    code: PermissionCodes.ACCOUNTING_DIMENSION_VIEW,
    module: 'accounting',
    description: 'View accounting dimensions',
  },
  {
    code: PermissionCodes.ACCOUNTING_DIMENSION_MANAGE,
    module: 'accounting',
    description: 'Manage accounting dimensions/rules',
  },
  {
    code: PermissionCodes.ACCOUNTING_MAPPING_VIEW,
    module: 'accounting',
    description: 'View accounting mappings',
  },
  {
    code: PermissionCodes.ACCOUNTING_MAPPING_MANAGE,
    module: 'accounting',
    description: 'Manage accounting mappings',
  },
  {
    code: PermissionCodes.ACCOUNTING_JOURNAL_VIEW,
    module: 'accounting',
    description: 'View journal entries',
  },
  {
    code: PermissionCodes.ACCOUNTING_JOURNAL_POST,
    module: 'accounting',
    description: 'Post journal entries',
  },
  {
    code: PermissionCodes.ACCOUNTING_JOURNAL_UNPOST,
    module: 'accounting',
    description: 'Unpost journal entries',
  },
  {
    code: PermissionCodes.ACCOUNTING_JOURNAL_REVERSE,
    module: 'accounting',
    description: 'Reverse posted journal entries',
  },
  {
    code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_VIEW,
    module: 'accounting',
    description: 'View manual operations',
  },
  {
    code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_CREATE,
    module: 'accounting',
    description: 'Create manual operations',
  },
  {
    code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_EDIT,
    module: 'accounting',
    description: 'Edit draft manual operations',
  },
  {
    code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_POST,
    module: 'accounting',
    description: 'Post manual operations',
  },
  {
    code: PermissionCodes.ACCOUNTING_MANUAL_OPERATION_UNPOST,
    module: 'accounting',
    description: 'Unpost manual operations',
  },
  {
    code: PermissionCodes.ACCOUNTING_OPENING_BALANCE_VIEW,
    module: 'accounting',
    description: 'View opening balances',
  },
  {
    code: PermissionCodes.ACCOUNTING_OPENING_BALANCE_MANAGE,
    module: 'accounting',
    description: 'Enter opening balances',
  },
  {
    code: PermissionCodes.ACCOUNTING_POSTING_HISTORY_VIEW,
    module: 'accounting',
    description: 'View posting run history',
  },
  {
    code: PermissionCodes.ACCOUNTING_TRIAL_BALANCE_VIEW,
    module: 'accounting',
    description: 'View the trial balance',
  },
  {
    code: PermissionCodes.ACCOUNTING_GENERAL_LEDGER_VIEW,
    module: 'accounting',
    description: 'View the general ledger',
  },
  {
    code: PermissionCodes.ACCOUNTING_FINANCIAL_STATEMENTS_VIEW,
    module: 'accounting',
    description: 'View the income statement and balance sheet',
  },

  {
    code: PermissionCodes.TAX_CONFIG_VIEW,
    module: 'tax',
    description: 'View tax configuration',
  },
  {
    code: PermissionCodes.TAX_RULE_VIEW,
    module: 'tax',
    description: 'View tax rules',
  },
  {
    code: PermissionCodes.TAX_RULE_CREATE,
    module: 'tax',
    description: 'Create tax rules',
  },
  {
    code: PermissionCodes.TAX_RULE_EDIT,
    module: 'tax',
    description: 'Edit tax rules',
  },
  {
    code: PermissionCodes.TAX_RULE_APPROVE,
    module: 'tax',
    description: 'Approve tax rules',
  },
  {
    code: PermissionCodes.TAX_RULE_ACTIVATE,
    module: 'tax',
    description: 'Activate tax rules',
  },
  {
    code: PermissionCodes.TAX_RATE_VIEW,
    module: 'tax',
    description: 'View tax rates',
  },
  {
    code: PermissionCodes.TAX_RATE_MANAGE,
    module: 'tax',
    description: 'Manage tax rates',
  },
  {
    code: PermissionCodes.TAX_CATEGORY_VIEW,
    module: 'tax',
    description: 'View tax categories',
  },
  {
    code: PermissionCodes.TAX_CATEGORY_MANAGE,
    module: 'tax',
    description: 'Manage tax categories',
  },
  {
    code: PermissionCodes.TAX_REGISTRATION_VIEW,
    module: 'tax',
    description: 'View tax registrations',
  },
  {
    code: PermissionCodes.TAX_REGISTRATION_MANAGE,
    module: 'tax',
    description: 'Manage tax registrations',
  },
  {
    code: PermissionCodes.TAX_MAPPING_VIEW,
    module: 'tax',
    description: 'View tax accounting mappings',
  },
  {
    code: PermissionCodes.TAX_MAPPING_MANAGE,
    module: 'tax',
    description: 'Manage tax accounting mappings',
  },
  {
    code: PermissionCodes.TAX_LEGAL_SOURCE_VIEW,
    module: 'tax',
    description: 'View tax legal sources',
  },
  {
    code: PermissionCodes.TAX_LEGAL_SOURCE_MANAGE,
    module: 'tax',
    description: 'Manage tax legal sources',
  },
  {
    code: PermissionCodes.TAX_CALCULATION_VIEW,
    module: 'tax',
    description: 'Preview/calculate tax',
  },
  {
    code: PermissionCodes.TAX_REGISTER_VIEW,
    module: 'tax',
    description: 'View the tax register',
  },
  {
    code: PermissionCodes.TAX_OVERRIDE,
    module: 'tax',
    description: 'Override a calculated tax amount',
  },
  {
    code: PermissionCodes.TAX_PERIOD_VIEW,
    module: 'tax',
    description: 'View tax periods',
  },
  {
    code: PermissionCodes.TAX_PERIOD_MANAGE,
    module: 'tax',
    description: 'Manage tax periods',
  },

  {
    code: PermissionCodes.SALES_CUSTOMER_REQUEST_VIEW,
    module: 'sales_preorder',
    description: 'View customer requests',
  },
  {
    code: PermissionCodes.SALES_CUSTOMER_REQUEST_CREATE,
    module: 'sales_preorder',
    description: 'Create customer requests',
  },
  {
    code: PermissionCodes.SALES_CUSTOMER_REQUEST_EDIT,
    module: 'sales_preorder',
    description: 'Edit customer requests',
  },
  {
    code: PermissionCodes.SALES_CUSTOMER_REQUEST_CANCEL,
    module: 'sales_preorder',
    description: 'Cancel customer requests',
  },
  {
    code: PermissionCodes.SALES_OFFER_VIEW,
    module: 'sales_preorder',
    description: 'View commercial offers',
  },
  {
    code: PermissionCodes.SALES_OFFER_CREATE,
    module: 'sales_preorder',
    description: 'Create commercial offers',
  },
  {
    code: PermissionCodes.SALES_OFFER_EDIT,
    module: 'sales_preorder',
    description: 'Edit commercial offers',
  },
  {
    code: PermissionCodes.SALES_OFFER_SEND,
    module: 'sales_preorder',
    description: 'Send a commercial offer to the customer',
  },
  {
    code: PermissionCodes.SALES_OFFER_ACCEPT,
    module: 'sales_preorder',
    description: 'Mark a commercial offer accepted/rejected',
  },
  {
    code: PermissionCodes.SALES_OFFER_CANCEL,
    module: 'sales_preorder',
    description: 'Cancel a commercial offer',
  },
  {
    code: PermissionCodes.SALES_OFFER_CONVERT,
    module: 'sales_preorder',
    description: 'Convert an offer into a customer order',
  },
  {
    code: PermissionCodes.SALES_ORDER_CONFIRM,
    module: 'sales_preorder',
    description: 'Confirm a customer order',
  },
  {
    code: PermissionCodes.SALES_ORDER_APPROVE,
    module: 'sales_preorder',
    description: 'Approve one step of a sales order approval chain',
  },
  {
    code: PermissionCodes.SALES_ORDER_REJECT,
    module: 'sales_preorder',
    description: 'Reject a sales order approval',
  },
  {
    code: PermissionCodes.SALES_ORDER_CANCEL,
    module: 'sales_preorder',
    description: 'Cancel a customer order',
  },
  {
    code: PermissionCodes.SALES_ORDER_REOPEN,
    module: 'sales_preorder',
    description: 'Reopen (unconfirm) a customer order',
  },
  {
    code: PermissionCodes.SALES_PRICE_OVERRIDE,
    module: 'sales_preorder',
    description: 'Override a resolved price',
  },
  {
    code: PermissionCodes.SALES_DISCOUNT_OVERRIDE,
    module: 'sales_preorder',
    description: 'Override a line/document discount',
  },
  {
    code: PermissionCodes.SALES_CREDIT_OVERRIDE,
    module: 'sales_preorder',
    description: 'Override a blocked credit check',
  },
  {
    code: PermissionCodes.SALES_RESERVATION_VIEW,
    module: 'sales_preorder',
    description: 'View stock reservations',
  },
  {
    code: PermissionCodes.SALES_RESERVATION_MANAGE,
    module: 'sales_preorder',
    description: 'Create/release stock reservations',
  },
  {
    code: PermissionCodes.SALES_SHIPMENT_PLAN_VIEW,
    module: 'sales_preorder',
    description: 'View shipment plans',
  },
  {
    code: PermissionCodes.SALES_SHIPMENT_PLAN_MANAGE,
    module: 'sales_preorder',
    description: 'Create/manage shipment plans',
  },
  {
    code: PermissionCodes.SALES_PAYMENT_SCHEDULE_VIEW,
    module: 'sales_preorder',
    description: 'View order payment schedules',
  },
  {
    code: PermissionCodes.SALES_FULFILLMENT_VIEW,
    module: 'sales_preorder',
    description: 'View order fulfillment status',
  },
  {
    code: PermissionCodes.SALES_ORDER_HOLD_MANAGE,
    module: 'sales_preorder',
    description: 'Place/release order holds',
  },

  {
    code: PermissionCodes.SALES_SHIPMENT_VIEW,
    module: 'sales_execution',
    description: 'View shipments',
  },
  {
    code: PermissionCodes.SALES_SHIPMENT_CREATE,
    module: 'sales_execution',
    description: 'Create shipments',
  },
  {
    code: PermissionCodes.SALES_SHIPMENT_EDIT,
    module: 'sales_execution',
    description: 'Edit shipments',
  },
  {
    code: PermissionCodes.SALES_SHIPMENT_CANCEL,
    module: 'sales_execution',
    description: 'Cancel shipments',
  },
  {
    code: PermissionCodes.SALES_INVOICE_REVERSE,
    module: 'sales_execution',
    description: 'Reverse a posted sales invoice',
  },
  {
    code: PermissionCodes.SALES_RETURN_VIEW,
    module: 'sales_execution',
    description: 'View sales returns',
  },
  {
    code: PermissionCodes.SALES_RETURN_CREATE,
    module: 'sales_execution',
    description: 'Create sales returns',
  },
  {
    code: PermissionCodes.SALES_RETURN_EDIT,
    module: 'sales_execution',
    description: 'Edit sales returns',
  },
  {
    code: PermissionCodes.SALES_ACCOUNTING_ENTRIES_VIEW,
    module: 'sales_execution',
    description: 'View accounting entries behind a sales document',
  },
  {
    code: PermissionCodes.SALES_TAX_DETAILS_VIEW,
    module: 'sales_execution',
    description: 'View tax calculation details behind a sales document',
  },

  {
    code: PermissionCodes.PURCHASE_REQUIREMENT_VIEW,
    module: 'procurement',
    description: 'View purchase requirements',
  },
  {
    code: PermissionCodes.PURCHASE_REQUIREMENT_CREATE,
    module: 'procurement',
    description: 'Create purchase requirements',
  },
  {
    code: PermissionCodes.PURCHASE_REQUIREMENT_EDIT,
    module: 'procurement',
    description: 'Edit purchase requirements',
  },
  {
    code: PermissionCodes.PURCHASE_REQUIREMENT_CANCEL,
    module: 'procurement',
    description: 'Cancel purchase requirements',
  },
  {
    code: PermissionCodes.PURCHASE_REQUIREMENT_APPROVE,
    module: 'procurement',
    description: 'Approve a purchase requirement (department head)',
  },
  {
    code: PermissionCodes.PURCHASE_REQUIREMENT_REJECT,
    module: 'procurement',
    description: 'Reject a purchase requirement',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_VIEW,
    module: 'procurement',
    description: 'View purchase orders',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_CREATE,
    module: 'procurement',
    description: 'Create purchase orders',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_EDIT,
    module: 'procurement',
    description: 'Edit purchase orders',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_APPROVE,
    module: 'procurement',
    description: 'Approve one step of a purchase order approval chain',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_REJECT,
    module: 'procurement',
    description: 'Reject a purchase order approval',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_CONFIRM,
    module: 'procurement',
    description: 'Confirm a purchase order (commercial commitment)',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_REOPEN,
    module: 'procurement',
    description: 'Reopen (unconfirm) a purchase order',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_CANCEL,
    module: 'procurement',
    description: 'Cancel a purchase order',
  },
  {
    code: PermissionCodes.PURCHASE_PRICE_OVERRIDE,
    module: 'procurement',
    description: 'Override a resolved purchase price',
  },
  {
    code: PermissionCodes.PURCHASE_SUPPLIER_SELECTION_VIEW,
    module: 'procurement',
    description: 'View supplier selection candidates',
  },
  {
    code: PermissionCodes.PURCHASE_SUPPLIER_SELECTION_MANAGE,
    module: 'procurement',
    description: 'Select/change a purchase order supplier',
  },
  {
    code: PermissionCodes.PURCHASE_EXPECTED_RECEIPT_VIEW,
    module: 'procurement',
    description: 'View expected supply/receipts',
  },
  {
    code: PermissionCodes.PURCHASE_PAYMENT_SCHEDULE_VIEW,
    module: 'procurement',
    description: 'View purchase order payment schedules',
  },
  {
    code: PermissionCodes.PURCHASE_PAYMENT_SCHEDULE_MANAGE,
    module: 'procurement',
    description: 'Generate purchase order payment schedules',
  },
  {
    code: PermissionCodes.PURCHASE_SUPPLY_PLANNING_VIEW,
    module: 'procurement',
    description: 'View demand coverage / supply planning',
  },
  {
    code: PermissionCodes.PURCHASE_SUPPLY_PEGGING_MANAGE,
    module: 'procurement',
    description: 'Create/remove demand-supply pegs',
  },
  {
    code: PermissionCodes.PURCHASE_ORDER_HOLD_MANAGE,
    module: 'procurement',
    description: 'Place/release purchase order holds',
  },
  {
    code: PermissionCodes.PURCHASE_SUPPLIER_PRODUCT_CODE_VIEW,
    module: 'procurement',
    description: 'View supplier product code mappings',
  },
  {
    code: PermissionCodes.PURCHASE_SUPPLIER_PRODUCT_CODE_MANAGE,
    module: 'procurement',
    description: 'Manage supplier product code mappings',
  },

  {
    code: PermissionCodes.PURCHASE_VIEW,
    module: 'purchase_execution',
    description:
      'View goods receipts, purchase invoices, returns, and additional costs',
  },
  {
    code: PermissionCodes.PURCHASE_CREATE,
    module: 'purchase_execution',
    description:
      'Create goods receipts, purchase invoices, and additional costs',
  },
  {
    code: PermissionCodes.PURCHASE_EDIT,
    module: 'purchase_execution',
    description: 'Edit draft goods receipts and purchase invoices',
  },
  {
    code: PermissionCodes.PURCHASE_RETURN,
    module: 'purchase_execution',
    description: 'Create purchase returns',
  },
  {
    code: PermissionCodes.PURCHASE_VIEW_ACCOUNTING,
    module: 'purchase_execution',
    description: 'View purchase reports and accounting entries',
  },
  {
    code: PermissionCodes.PURCHASE_PRICE_VIEW,
    module: 'purchase_execution',
    description:
      'View and override price/tax/monetary fields on goods receipts',
  },
  {
    code: PermissionCodes.PURCHASE_RECEIPT_APPROVE,
    module: 'purchase_execution',
    description: 'Approve an over-delivery on a goods receipt',
  },
  {
    code: PermissionCodes.PURCHASE_RECEIPT_REJECT,
    module: 'purchase_execution',
    description: 'Reject an over-delivery on a goods receipt',
  },
  {
    code: PermissionCodes.PURCHASE_INVOICE_APPROVE,
    module: 'purchase_execution',
    description: 'Approve a purchase invoice price variance',
  },
  {
    code: PermissionCodes.PURCHASE_INVOICE_REJECT,
    module: 'purchase_execution',
    description: 'Reject a purchase invoice price variance',
  },

  {
    code: PermissionCodes.PAYMENT_REQUEST_VIEW,
    module: 'treasury',
    description: 'View payment requests',
  },
  {
    code: PermissionCodes.PAYMENT_REQUEST_CREATE,
    module: 'treasury',
    description: 'Create payment requests',
  },
  {
    code: PermissionCodes.PAYMENT_REQUEST_CANCEL,
    module: 'treasury',
    description: 'Cancel payment requests',
  },
  {
    code: PermissionCodes.PAYMENT_ORDER_VIEW,
    module: 'treasury',
    description: 'View payment orders',
  },
  {
    code: PermissionCodes.PAYMENT_ORDER_CREATE,
    module: 'treasury',
    description: 'Create payment orders',
  },
  {
    code: PermissionCodes.PAYMENT_ORDER_EDIT,
    module: 'treasury',
    description: 'Edit draft payment orders',
  },
  {
    code: PermissionCodes.PAYMENT_ORDER_APPROVE,
    module: 'treasury',
    description: 'Approve a payment order (finance)',
  },
  {
    code: PermissionCodes.PAYMENT_ORDER_REJECT,
    module: 'treasury',
    description: 'Reject a payment order',
  },
  {
    code: PermissionCodes.PAYMENT_ORDER_RECONCILE,
    module: 'treasury',
    description: 'Reconcile a posted payment order against a bank statement',
  },
  {
    code: PermissionCodes.CASH_TRANSACTION_VIEW,
    module: 'treasury',
    description: 'View cash transactions (Kassa mədaxil/məxaric)',
  },
  {
    code: PermissionCodes.CASH_TRANSACTION_CREATE,
    module: 'treasury',
    description: 'Create cash transactions',
  },
  {
    code: PermissionCodes.CASH_TRANSACTION_EDIT,
    module: 'treasury',
    description: 'Edit draft cash transactions',
  },
  {
    code: PermissionCodes.TREASURY_RECONCILIATION_VIEW,
    module: 'treasury',
    description: 'View bank statement lines',
  },
  {
    code: PermissionCodes.TREASURY_RECONCILIATION_MANAGE,
    module: 'treasury',
    description: 'Enter and match bank statement lines',
  },
  {
    code: PermissionCodes.BANK_VIEW,
    module: 'treasury',
    description: 'View the bank (institution) catalog',
  },
  {
    code: PermissionCodes.BANK_CREATE,
    module: 'treasury',
    description: 'Create bank catalog entries',
  },
  {
    code: PermissionCodes.BANK_EDIT,
    module: 'treasury',
    description: 'Edit bank catalog entries',
  },
  {
    code: PermissionCodes.BANK_DEACTIVATE,
    module: 'treasury',
    description: 'Deactivate a bank catalog entry',
  },
  {
    code: PermissionCodes.CASH_FLOW_VIEW,
    module: 'treasury',
    description: 'View the cash flow statement (bank + cashbox movements)',
  },

  {
    code: PermissionCodes.PAYMENT_REQUEST_APPROVE,
    module: 'treasury',
    description: 'Approve or reject a payment request approval step',
  },
  {
    code: PermissionCodes.TREASURY_VIEW_LIQUIDITY,
    module: 'treasury',
    description: 'View the payment calendar and liquidity forecast',
  },
  {
    code: PermissionCodes.TREASURY_LIQUIDITY_POLICY_MANAGE,
    module: 'treasury',
    description: 'Configure minimum-cash-buffer policies',
  },
  {
    code: PermissionCodes.TREASURY_APPROVAL_RULE_MANAGE,
    module: 'treasury',
    description: 'Configure the payment request approval-tier rules',
  },
  {
    code: PermissionCodes.INCOMING_BANK_PAYMENT_VIEW,
    module: 'treasury',
    description: 'View incoming bank payments',
  },
  {
    code: PermissionCodes.INCOMING_BANK_PAYMENT_CREATE,
    module: 'treasury',
    description: 'Create incoming bank payments',
  },
  {
    code: PermissionCodes.INCOMING_BANK_PAYMENT_EDIT,
    module: 'treasury',
    description: 'Edit draft incoming bank payments',
  },
  {
    code: PermissionCodes.INTERNAL_BANK_TRANSFER_VIEW,
    module: 'treasury',
    description: 'View internal bank transfers',
  },
  {
    code: PermissionCodes.INTERNAL_BANK_TRANSFER_CREATE,
    module: 'treasury',
    description: 'Create internal bank transfers',
  },
  {
    code: PermissionCodes.BANK_FEE_VIEW,
    module: 'treasury',
    description: 'View bank fees',
  },
  {
    code: PermissionCodes.BANK_FEE_CREATE,
    module: 'treasury',
    description: 'Create bank fees',
  },
  {
    code: PermissionCodes.FX_CONVERSION_VIEW,
    module: 'treasury',
    description: 'View FX conversions',
  },
  {
    code: PermissionCodes.FX_CONVERSION_CREATE,
    module: 'treasury',
    description: 'Create FX conversions',
  },
  {
    code: PermissionCodes.BANK_RECONCILIATION_MANAGE,
    module: 'treasury',
    description: 'Create and refresh a bank reconciliation period',
  },
  {
    code: PermissionCodes.BANK_RECONCILIATION_CLOSE,
    module: 'treasury',
    description: 'Close a bank reconciliation period',
  },
  {
    code: PermissionCodes.BANK_RECONCILIATION_REOPEN,
    module: 'treasury',
    description: 'Reopen a closed bank reconciliation period',
  },
  {
    code: PermissionCodes.TREASURY_HEALTH_VIEW,
    module: 'treasury',
    description: 'View the treasury health report',
  },

  {
    code: PermissionCodes.CASH_VIEW,
    module: 'cash_desk',
    description: 'View cash desk documents',
  },
  {
    code: PermissionCodes.CASH_VIEW_BALANCE,
    module: 'cash_desk',
    description: 'View a cash desk book balance',
  },
  {
    code: PermissionCodes.CASH_RECEIPT_CREATE,
    module: 'cash_desk',
    description: 'Create a cash receipt (mədaxil)',
  },
  {
    code: PermissionCodes.CASH_RECEIPT_POST,
    module: 'cash_desk',
    description: 'Post a cash receipt',
  },
  {
    code: PermissionCodes.CASH_EXPENSE_CREATE,
    module: 'cash_desk',
    description: 'Create a cash expense (məxaric)',
  },
  {
    code: PermissionCodes.CASH_EXPENSE_POST,
    module: 'cash_desk',
    description: 'Post a cash expense',
  },
  {
    code: PermissionCodes.CASH_TRANSFER_CREATE,
    module: 'cash_desk',
    description: 'Create a cash-to-cash transfer',
  },
  {
    code: PermissionCodes.CASH_TRANSFER_POST,
    module: 'cash_desk',
    description: 'Post a cash-to-cash transfer',
  },
  {
    code: PermissionCodes.CASH_TRANSFER_RECEIVE,
    module: 'cash_desk',
    description: 'Receive a two-step cash-to-cash transfer',
  },
  {
    code: PermissionCodes.CASH_COUNT,
    module: 'cash_desk',
    description: 'Run and submit a cash physical count',
  },
  {
    code: PermissionCodes.CASH_DAILY_CLOSE,
    module: 'cash_desk',
    description: 'Refresh and close a cash desk daily close',
  },
  {
    code: PermissionCodes.CASH_DAILY_CLOSE_REOPEN,
    module: 'cash_desk',
    description: 'Reopen a closed cash desk daily close',
  },
  {
    code: PermissionCodes.CASH_ADJUSTMENT_CREATE,
    module: 'cash_desk',
    description: 'Create a cash count adjustment',
  },
  {
    code: PermissionCodes.CASH_ADJUSTMENT_APPROVE,
    module: 'cash_desk',
    description: 'Approve/post a cash count adjustment',
  },
  {
    code: PermissionCodes.CASH_VIEW_OTHER_CASHIERS,
    module: 'cash_desk',
    description: "View other cashiers' documents and balances",
  },
  {
    code: PermissionCodes.CASH_OVERRIDE_NEGATIVE,
    module: 'cash_desk',
    description: 'Override the negative-cash-balance block',
  },
  {
    code: PermissionCodes.CASH_VIEW_ACCOUNTING,
    module: 'cash_desk',
    description: 'View the GL postings behind a cash document',
  },
  {
    code: PermissionCodes.CASH_PERIOD_OVERRIDE,
    module: 'cash_desk',
    description: 'Post a cash document into a closed period',
  },
  {
    code: PermissionCodes.CASHIER_ASSIGNMENT_MANAGE,
    module: 'cash_desk',
    description: 'Assign or end a cashier assignment',
  },
  {
    code: PermissionCodes.CASH_DENOMINATION_MANAGE,
    module: 'cash_desk',
    description: 'Manage the currency denomination catalog',
  },
  {
    code: PermissionCodes.CASHIER_HANDOVER_MANAGE,
    module: 'cash_desk',
    description: 'Create and complete a cashier handover',
  },

  {
    code: PermissionCodes.FIXED_ASSET_VIEW,
    module: 'fixed_asset',
    description: 'View fixed assets and their lifecycle documents',
  },
  {
    code: PermissionCodes.FIXED_ASSET_VIEW_COST,
    module: 'fixed_asset',
    description: 'View fixed asset cost/depreciation figures',
  },
  {
    code: PermissionCodes.FIXED_ASSET_CREATE,
    module: 'fixed_asset',
    description:
      'Create acquisition candidates, CIP projects, and fixed assets',
  },
  {
    code: PermissionCodes.FIXED_ASSET_ACCEPT,
    module: 'fixed_asset',
    description: 'Accept a fixed asset into the register',
  },
  {
    code: PermissionCodes.FIXED_ASSET_COMMISSION,
    module: 'fixed_asset',
    description: 'Commission a fixed asset (starts depreciation eligibility)',
  },
  {
    code: PermissionCodes.FIXED_ASSET_TRANSFER,
    module: 'fixed_asset',
    description:
      'Transfer a fixed asset between department/location/responsible person',
  },
  {
    code: PermissionCodes.FIXED_ASSET_MODERNIZE,
    module: 'fixed_asset',
    description: 'Create and post a fixed asset modernization',
  },
  {
    code: PermissionCodes.FIXED_ASSET_CHANGE_USEFUL_LIFE,
    module: 'fixed_asset',
    description: 'Change a fixed asset useful life / residual value / method',
  },
  {
    code: PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE,
    module: 'fixed_asset',
    description: 'Preview/calculate a depreciation run',
  },
  {
    code: PermissionCodes.FIXED_ASSET_DEPRECIATION_POST,
    module: 'fixed_asset',
    description: 'Post a calculated depreciation run to the GL',
  },
  {
    code: PermissionCodes.FIXED_ASSET_IMPAIR,
    module: 'fixed_asset',
    description: 'Create and post a fixed asset impairment',
  },
  {
    code: PermissionCodes.FIXED_ASSET_REVALUE,
    module: 'fixed_asset',
    description: 'Create and post a fixed asset revaluation',
  },
  {
    code: PermissionCodes.FIXED_ASSET_INVENTORY,
    module: 'fixed_asset',
    description: 'Run a fixed asset physical inventory count',
  },
  {
    code: PermissionCodes.FIXED_ASSET_DISPOSE,
    module: 'fixed_asset',
    description: 'Create and post a fixed asset disposal/sale',
  },
  {
    code: PermissionCodes.FIXED_ASSET_WRITE_OFF,
    module: 'fixed_asset',
    description: 'Create and post a fixed asset write-off',
  },
  {
    code: PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT,
    module: 'fixed_asset',
    description: 'Make a privileged manual fixed asset cost adjustment',
  },
  {
    code: PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING,
    module: 'fixed_asset',
    description: 'View the GL postings behind a fixed asset document',
  },
  {
    code: PermissionCodes.FIXED_ASSET_PERIOD_OVERRIDE,
    module: 'fixed_asset',
    description: 'Post a fixed asset document into a closed period',
  },

  {
    code: PermissionCodes.HR_PERSON_VIEW,
    module: 'hr',
    description: 'View physical person records',
  },
  {
    code: PermissionCodes.HR_PERSON_CREATE,
    module: 'hr',
    description: 'Create physical person records',
  },
  {
    code: PermissionCodes.HR_PERSON_EDIT,
    module: 'hr',
    description: 'Edit physical person records',
  },
  {
    code: PermissionCodes.HR_EMPLOYEE_VIEW,
    module: 'hr',
    description: 'View employees, employments and their history',
  },
  {
    code: PermissionCodes.HR_EMPLOYEE_CREATE,
    module: 'hr',
    description: 'Create new employee identities',
  },
  {
    code: PermissionCodes.HR_EMPLOYMENT_CREATE,
    module: 'hr',
    description: 'Create employment relationships directly (non-hire path)',
  },
  {
    code: PermissionCodes.HR_HIRE_CREATE,
    module: 'hr',
    description: 'Create hire (and rehire) documents',
  },
  {
    code: PermissionCodes.HR_HIRE_POST,
    module: 'hr',
    description: 'Post a hire document, activating the employment',
  },
  {
    code: PermissionCodes.HR_HIRE_APPROVE,
    module: 'hr',
    description: 'Approve a pending hire document',
  },
  {
    code: PermissionCodes.HR_HIRE_REJECT,
    module: 'hr',
    description: 'Reject a pending hire document',
  },
  {
    code: PermissionCodes.HR_TRANSFER_CREATE,
    module: 'hr',
    description: 'Create employee transfer documents',
  },
  {
    code: PermissionCodes.HR_TRANSFER_POST,
    module: 'hr',
    description: 'Post an employee transfer document',
  },
  {
    code: PermissionCodes.HR_TRANSFER_APPROVE,
    module: 'hr',
    description: 'Approve a pending employee transfer document',
  },
  {
    code: PermissionCodes.HR_TRANSFER_REJECT,
    module: 'hr',
    description: 'Reject a pending employee transfer document',
  },
  {
    code: PermissionCodes.HR_TERMINATE_CREATE,
    module: 'hr',
    description: 'Create termination documents',
  },
  {
    code: PermissionCodes.HR_TERMINATE_POST,
    module: 'hr',
    description: 'Post a termination document, closing the employment',
  },
  {
    code: PermissionCodes.HR_TERMINATE_APPROVE,
    module: 'hr',
    description: 'Approve a pending termination document',
  },
  {
    code: PermissionCodes.HR_TERMINATE_REJECT,
    module: 'hr',
    description: 'Reject a pending termination document',
  },
  {
    code: PermissionCodes.HR_CONTRACT_VIEW,
    module: 'hr',
    description: 'View employment contracts and their version history',
  },
  {
    code: PermissionCodes.HR_CONTRACT_EDIT,
    module: 'hr',
    description: 'Create/amend employment contracts',
  },
  {
    code: PermissionCodes.HR_STAFFING_VIEW,
    module: 'hr',
    description: 'View staffing tables and planned positions',
  },
  {
    code: PermissionCodes.HR_STAFFING_EDIT,
    module: 'hr',
    description: 'Create/edit staffing tables and planned positions',
  },
  {
    code: PermissionCodes.HR_LEAVE_VIEW,
    module: 'hr',
    description: 'View leave records',
  },
  {
    code: PermissionCodes.HR_LEAVE_CREATE,
    module: 'hr',
    description: 'Create leave records',
  },
  {
    code: PermissionCodes.HR_ABSENCE_VIEW,
    module: 'hr',
    description: 'View absence records',
  },
  {
    code: PermissionCodes.HR_ABSENCE_CREATE,
    module: 'hr',
    description: 'Create absence records',
  },
  {
    code: PermissionCodes.HR_VIEW_PERSONAL_DATA,
    module: 'hr',
    description: 'View personal data (contact info, address, personal ID)',
  },
  {
    code: PermissionCodes.HR_VIEW_SENSITIVE_DATA,
    module: 'hr',
    description: 'View sensitive data (compensation reference, contract conditions)',
  },
  {
    code: PermissionCodes.HR_VIEW_HISTORY,
    module: 'hr',
    description: 'View full assignment/status/contract history for an employment',
  },
  {
    code: PermissionCodes.HR_OVERRIDE_STAFFING_LIMIT,
    module: 'hr',
    description: 'Hire/transfer beyond a staffing position\'s headcount/FTE limit',
  },
  {
    code: PermissionCodes.HR_REPORT_VIEW,
    module: 'hr',
    description: 'View HR reports (org chart, headcount, staffing capacity)',
  },

  {
    code: PermissionCodes.TIME_VIEW,
    module: 'work_time',
    description: 'View work-time data across the organization',
  },
  {
    code: PermissionCodes.TIME_VIEW_OWN,
    module: 'work_time',
    description: 'View own attendance/timesheet data',
  },
  {
    code: PermissionCodes.TIME_VIEW_DEPARTMENT,
    module: 'work_time',
    description: "View a manager's own department work-time data",
  },
  {
    code: PermissionCodes.TIME_CALENDAR_EDIT,
    module: 'work_time',
    description: 'Create/edit production calendars and calendar days',
  },
  {
    code: PermissionCodes.TIME_SCHEDULE_EDIT,
    module: 'work_time',
    description: 'Create/edit work schedule templates, patterns, and shift templates',
  },
  {
    code: PermissionCodes.TIME_ATTENDANCE_IMPORT,
    module: 'work_time',
    description: 'Import/create raw attendance events',
  },
  {
    code: PermissionCodes.TIME_ATTENDANCE_EDIT,
    module: 'work_time',
    description: 'Edit/flag attendance events and intervals',
  },
  {
    code: PermissionCodes.TIME_TIMESHEET_CREATE,
    module: 'work_time',
    description: 'Generate a timesheet for a period',
  },
  {
    code: PermissionCodes.TIME_TIMESHEET_EDIT,
    module: 'work_time',
    description: 'Edit timesheet lines',
  },
  {
    code: PermissionCodes.TIME_TIMESHEET_APPROVE,
    module: 'work_time',
    description: 'Approve a submitted timesheet',
  },
  {
    code: PermissionCodes.TIME_TIMESHEET_LOCK,
    module: 'work_time',
    description: 'Lock an approved timesheet, writing it to the Work Time Register',
  },
  {
    code: PermissionCodes.TIME_TIMESHEET_REOPEN,
    module: 'work_time',
    description: 'Reopen a locked timesheet',
  },
  {
    code: PermissionCodes.TIME_OVERTIME_CREATE,
    module: 'work_time',
    description: 'Create an overtime request',
  },
  {
    code: PermissionCodes.TIME_OVERTIME_APPROVE,
    module: 'work_time',
    description: 'Approve an overtime request',
  },
  {
    code: PermissionCodes.TIME_CORRECTION_CREATE,
    module: 'work_time',
    description: 'Create a time correction',
  },
  {
    code: PermissionCodes.TIME_CORRECTION_APPROVE,
    module: 'work_time',
    description: 'Apply a time correction, including against a locked timesheet',
  },
  {
    code: PermissionCodes.TIME_VIEW_PAYROLL_INPUT,
    module: 'work_time',
    description: 'View the generated Payroll Time Input Register',
  },
  {
    code: PermissionCodes.TIME_OVERRIDE_VALIDATION,
    module: 'work_time',
    description: 'Override a work-time validation exception (e.g. approve a timesheet with unresolved exceptions)',
  },

  {
    code: PermissionCodes.PAYROLL_VIEW,
    module: 'payroll',
    description: 'View payroll data across the organization',
  },
  {
    code: PermissionCodes.PAYROLL_VIEW_OWN,
    module: 'payroll',
    description: 'View own payslip/payroll data',
  },
  {
    code: PermissionCodes.PAYROLL_VIEW_DEPARTMENT,
    module: 'payroll',
    description: "View a manager's own department payroll aggregate",
  },
  {
    code: PermissionCodes.PAYROLL_VIEW_SALARY,
    module: 'payroll',
    description: 'View individual salary/compensation amounts',
  },
  {
    code: PermissionCodes.PAYROLL_EDIT_COMPENSATION,
    module: 'payroll',
    description: 'Create/edit employee compensation assignments',
  },
  {
    code: PermissionCodes.PAYROLL_CREATE_VARIABLE_INPUT,
    module: 'payroll',
    description: 'Create bonus/allowance/manual variable payroll inputs',
  },
  {
    code: PermissionCodes.PAYROLL_CALCULATE,
    module: 'payroll',
    description: 'Run a payroll calculation',
  },
  {
    code: PermissionCodes.PAYROLL_RECALCULATE,
    module: 'payroll',
    description: 'Trigger a payroll recalculation/retro run',
  },
  {
    code: PermissionCodes.PAYROLL_APPROVE,
    module: 'payroll',
    description: 'Approve a calculated payroll period',
  },
  {
    code: PermissionCodes.PAYROLL_POST,
    module: 'payroll',
    description: 'Post payroll to the general ledger',
  },
  {
    code: PermissionCodes.PAYROLL_CLOSE,
    module: 'payroll',
    description: 'Close a payroll period',
  },
  {
    code: PermissionCodes.PAYROLL_REOPEN,
    module: 'payroll',
    description: 'Reopen a closed/approved payroll period',
  },
  {
    code: PermissionCodes.PAYROLL_CREATE_PAYMENT_BATCH,
    module: 'payroll',
    description: 'Create a salary payment batch',
  },
  {
    code: PermissionCodes.PAYROLL_VIEW_TAX,
    module: 'payroll',
    description: 'View employee tax profile and tax calculation detail',
  },
  {
    code: PermissionCodes.PAYROLL_EDIT_TAX_PROFILE,
    module: 'payroll',
    description: 'Edit employee tax profile',
  },
  {
    code: PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS,
    module: 'payroll',
    description: 'Manage deduction definitions and execution orders',
  },
  {
    code: PermissionCodes.PAYROLL_MANUAL_ADJUSTMENT,
    module: 'payroll',
    description: 'Manually override a calculated payroll amount',
  },
  {
    code: PermissionCodes.PAYROLL_VIEW_ACCOUNTING,
    module: 'payroll',
    description: 'View the accounting/GL side of payroll postings',
  },
  {
    code: PermissionCodes.PAYROLL_VIEW_LEGAL_TRACE,
    module: 'payroll',
    description: 'View the legal/config rule trace behind a payroll calculation line',
  },

  {
    code: PermissionCodes.EXPENSE_VIEW,
    module: 'expense',
    description: 'View expense data across the organization',
  },
  {
    code: PermissionCodes.EXPENSE_VIEW_OWN,
    module: 'expense',
    description: 'View own expense claims',
  },
  {
    code: PermissionCodes.EXPENSE_VIEW_DEPARTMENT,
    module: 'expense',
    description: "View a manager's own department/team expense claims",
  },
  {
    code: PermissionCodes.EXPENSE_CLAIM_CREATE,
    module: 'expense',
    description: 'Create/edit an expense claim',
  },
  {
    code: PermissionCodes.EXPENSE_CLAIM_SUBMIT,
    module: 'expense',
    description: 'Submit an expense claim for approval',
  },
  {
    code: PermissionCodes.EXPENSE_CLAIM_APPROVE,
    module: 'expense',
    description: 'Approve/reject expense claim lines',
  },
  {
    code: PermissionCodes.EXPENSE_CLAIM_POST,
    module: 'expense',
    description: 'Post an approved expense claim to the general ledger',
  },
  {
    code: PermissionCodes.EXPENSE_RECEIPT_REVIEW,
    module: 'expense',
    description: 'Review/validate expense receipts',
  },
  {
    code: PermissionCodes.EXPENSE_POLICY_OVERRIDE,
    module: 'expense',
    description: 'Approve a claim line that exceeds expense policy limits',
  },
  {
    code: PermissionCodes.EXPENSE_TAX_OVERRIDE,
    module: 'expense',
    description: 'Manually correct a tax/VAT assessment on an expense line',
  },
  {
    code: PermissionCodes.EXPENSE_ALLOCATION_EDIT,
    module: 'expense',
    description: 'Create/edit allocation rules and driver values',
  },
  {
    code: PermissionCodes.EXPENSE_ALLOCATION_RUN,
    module: 'expense',
    description: 'Preview, calculate, and post a cost allocation run',
  },
  {
    code: PermissionCodes.EXPENSE_PREPAID_CREATE,
    module: 'expense',
    description: 'Create a prepaid expense and its recognition schedule',
  },
  {
    code: PermissionCodes.EXPENSE_PREPAID_ADJUST,
    module: 'expense',
    description: 'Adjust a prepaid expense schedule (early cancellation, correction)',
  },
  {
    code: PermissionCodes.EXPENSE_RECLASSIFY,
    module: 'expense',
    description: 'Reclassify a posted expense line (cost center/project/tax correction)',
  },
  {
    code: PermissionCodes.EXPENSE_VIEW_EMPLOYEE_BALANCE,
    module: 'expense',
    description: "View an employee's advance/reimbursement/debt settlement balance",
  },
  {
    code: PermissionCodes.EXPENSE_VIEW_COST_CENTER,
    module: 'expense',
    description: 'View cost center expense/allocation reports',
  },
  {
    code: PermissionCodes.EXPENSE_VIEW_ACCOUNTING,
    module: 'expense',
    description: 'View the accounting/GL side of expense postings',
  },
  {
    code: PermissionCodes.EXPENSE_PERIOD_REOPEN,
    module: 'expense',
    description: 'Reopen a closed expense period',
  },
  {
    code: PermissionCodes.EXPENSE_MANAGE_CATALOG,
    module: 'expense',
    description: 'Manage expense categories, policies, cost centers, and allocation drivers',
  },
  {
    code: PermissionCodes.EXPENSE_MANAGE_BUDGET,
    module: 'expense',
    description: 'Create/edit expense budgets',
  },

  {
    code: PermissionCodes.INVENTORY_VIEW,
    module: 'inventory',
    description: 'View stock balances and movements for accessible warehouses',
  },
  {
    code: PermissionCodes.INVENTORY_VIEW_ALL_WAREHOUSES,
    module: 'inventory',
    description: 'View stock across all warehouses, not just assigned ones',
  },
  {
    code: PermissionCodes.INVENTORY_TRANSFER_CREATE,
    module: 'inventory',
    description: 'Create warehouse transfers',
  },
  {
    code: PermissionCodes.INVENTORY_TRANSFER_POST,
    module: 'inventory',
    description: 'Post/ship warehouse transfers',
  },
  {
    code: PermissionCodes.INVENTORY_TRANSFER_RECEIVE,
    module: 'inventory',
    description: 'Receive warehouse transfers at the destination',
  },
  {
    code: PermissionCodes.INVENTORY_INTERNAL_MOVE,
    module: 'inventory',
    description: 'Move stock between locations within a warehouse',
  },
  {
    code: PermissionCodes.INVENTORY_CONSUME,
    module: 'inventory',
    description: 'Post internal consumption documents',
  },
  {
    code: PermissionCodes.INVENTORY_WRITE_OFF,
    module: 'inventory',
    description: 'Create write-off/surplus inventory adjustments',
  },
  {
    code: PermissionCodes.INVENTORY_WRITE_OFF_APPROVE,
    module: 'inventory',
    description: 'Approve/post inventory adjustments',
  },
  {
    code: PermissionCodes.INVENTORY_STATUS_CHANGE,
    module: 'inventory',
    description: 'Transfer stock between quality/inventory statuses',
  },
  {
    code: PermissionCodes.INVENTORY_RESERVE,
    module: 'inventory',
    description: 'Reserve stock',
  },
  {
    code: PermissionCodes.INVENTORY_RELEASE_RESERVATION,
    module: 'inventory',
    description: 'Release stock reservations',
  },
  {
    code: PermissionCodes.INVENTORY_OVERRIDE_NEGATIVE,
    module: 'inventory',
    description: 'Override negative-stock blocking',
  },
  {
    code: PermissionCodes.INVENTORY_VIEW_SERIAL_HISTORY,
    module: 'inventory',
    description: 'View full movement history for a serial number',
  },
  {
    code: PermissionCodes.INVENTORY_VIEW_MOVEMENTS,
    module: 'inventory',
    description: 'View the inventory movement register',
  },
  {
    code: PermissionCodes.INVENTORY_UNPOST,
    module: 'inventory',
    description: 'Unpost inventory documents',
  },
  {
    code: PermissionCodes.INVENTORY_PERIOD_OVERRIDE,
    module: 'inventory',
    description: 'Post inventory documents into a closed period',
  },
  {
    code: PermissionCodes.INVENTORY_MANUAL_ADJUSTMENT,
    module: 'inventory',
    description: 'Manually adjust stock outside the normal document flow',
  },

  {
    code: PermissionCodes.INVENTORY_COST_VIEW,
    module: 'inventory_cost',
    description: 'View inventory valuation and unit cost',
  },
  {
    code: PermissionCodes.INVENTORY_COST_VIEW_LAYERS,
    module: 'inventory_cost',
    description: 'View FIFO cost layers',
  },
  {
    code: PermissionCodes.INVENTORY_COST_RECALCULATE,
    module: 'inventory_cost',
    description: 'Trigger cost recalculation',
  },
  {
    code: PermissionCodes.INVENTORY_COST_FINALIZE,
    module: 'inventory_cost',
    description: 'Finalize inventory costing for a period',
  },
  {
    code: PermissionCodes.INVENTORY_COST_REOPEN,
    module: 'inventory_cost',
    description: 'Reopen a finalized costing period',
  },
  {
    code: PermissionCodes.INVENTORY_COST_ADJUST,
    module: 'inventory_cost',
    description: 'Create manual cost adjustments',
  },
  {
    code: PermissionCodes.INVENTORY_COST_MANUAL_OVERRIDE,
    module: 'inventory_cost',
    description: 'Manually override a calculated cost',
  },
  {
    code: PermissionCodes.INVENTORY_COST_VIEW_ERRORS,
    module: 'inventory_cost',
    description: 'View costing errors',
  },
  {
    code: PermissionCodes.INVENTORY_COST_VIEW_COGS,
    module: 'inventory_cost',
    description: 'View COGS',
  },
  {
    code: PermissionCodes.INVENTORY_COST_VIEW_ACCOUNTING,
    module: 'inventory_cost',
    description: 'View costing accounting entries',
  },
  {
    code: PermissionCodes.INVENTORY_COST_POLICY_MANAGE,
    module: 'inventory_cost',
    description: 'Manage inventory costing policy',
  },

  {
    code: PermissionCodes.INVENTORY_COUNT_VIEW,
    module: 'inventory_count',
    description: 'View inventory count plans, sessions, and results',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_PLAN,
    module: 'inventory_count',
    description: 'Create and configure inventory count plans',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_MANAGE_SCOPE,
    module: 'inventory_count',
    description: 'Define which inventory a count plan covers',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_START_SESSION,
    module: 'inventory_count',
    description: 'Start a count session and generate its snapshot',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_ENTER,
    module: 'inventory_count',
    description: 'Enter physical count quantities',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_VIEW_ACCOUNTING_QUANTITY,
    module: 'inventory_count',
    description: 'View the accounting (book) quantity during a blind count',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_RECOUNT,
    module: 'inventory_count',
    description: 'Perform a recount',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_DECIDE_VARIANCE,
    module: 'inventory_count',
    description: 'Decide how a counted variance should be resolved',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_APPROVE,
    module: 'inventory_count',
    description: 'Approve variance decisions for posting',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_POST_ADJUSTMENTS,
    module: 'inventory_count',
    description: 'Post the stock/GL corrections a count session produced',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_RECONCILE,
    module: 'inventory_count',
    description: 'Run and view count reconciliation',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_CLOSE,
    module: 'inventory_count',
    description: 'Close a completed count session',
  },
  {
    code: PermissionCodes.INVENTORY_COUNT_CANCEL,
    module: 'inventory_count',
    description: 'Cancel a count plan or session',
  },

  {
    code: PermissionCodes.SETTLEMENT_VIEW,
    module: 'settlement',
    description: 'View settlement open items, balances, and reports',
  },
  {
    code: PermissionCodes.SETTLEMENT_VIEW_ALL,
    module: 'settlement',
    description: 'View settlement data across all counterparties/organizations',
  },
  {
    code: PermissionCodes.SETTLEMENT_ALLOCATE,
    module: 'settlement',
    description: 'Manually allocate a payment against open items',
  },
  {
    code: PermissionCodes.SETTLEMENT_AUTO_ALLOCATE,
    module: 'settlement',
    description: 'Trigger automatic payment allocation',
  },
  {
    code: PermissionCodes.SETTLEMENT_REVERSE_ALLOCATION,
    module: 'settlement',
    description: 'Reverse a payment allocation',
  },
  {
    code: PermissionCodes.SETTLEMENT_APPLY_ADVANCE,
    module: 'settlement',
    description: 'Apply a customer/supplier advance to an open item',
  },
  {
    code: PermissionCodes.SETTLEMENT_CREATE_ADJUSTMENT,
    module: 'settlement',
    description: 'Create a manual debt adjustment',
  },
  {
    code: PermissionCodes.SETTLEMENT_APPROVE_ADJUSTMENT,
    module: 'settlement',
    description: 'Approve and post a debt adjustment',
  },
  {
    code: PermissionCodes.SETTLEMENT_WRITE_OFF,
    module: 'settlement',
    description: 'Write off a receivable/payable balance',
  },
  {
    code: PermissionCodes.SETTLEMENT_OFFSET,
    module: 'settlement',
    description: 'Create and post an AR/AP offset (netting)',
  },
  {
    code: PermissionCodes.SETTLEMENT_RECONCILE,
    module: 'settlement',
    description: 'Generate and confirm counterparty reconciliation statements',
  },
  {
    code: PermissionCodes.SETTLEMENT_VIEW_FX,
    module: 'settlement',
    description: 'View realized FX detail on settlement allocations',
  },
  {
    code: PermissionCodes.SETTLEMENT_OVERRIDE_FX,
    module: 'settlement',
    description: 'Manually override an exchange rate used in settlement',
  },
  {
    code: PermissionCodes.SETTLEMENT_VIEW_ACCOUNTING,
    module: 'settlement',
    description: 'View the accounting/GL side of settlement documents',
  },
  {
    code: PermissionCodes.SETTLEMENT_OVERRIDE_CONTRACT,
    module: 'settlement',
    description:
      'Reclassify an open item to a different contract or counterparty',
  },
  {
    code: PermissionCodes.SETTLEMENT_PERIOD_OVERRIDE,
    module: 'settlement',
    description: 'Post a settlement adjustment into a locked period',
  },
];
