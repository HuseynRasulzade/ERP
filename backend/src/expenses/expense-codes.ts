/**
 * Standard expense category codes (docx spec Phase 20 section 7). Same
 * convention as `TimeCodes`/`EarningCodes` elsewhere in this codebase: a
 * fixed set of seed constants, while the actual `ExpenseCategory` ROWS
 * remain fully DB-backed and tenant-editable (limits, eligibility flags,
 * accounting mapping).
 */
export const ExpenseCategoryCodes = {
  TRAVEL: 'TRAVEL',
  HOTEL: 'HOTEL',
  TAXI: 'TAXI',
  FUEL: 'FUEL',
  MEALS: 'MEALS',
  REPRESENTATION: 'REPRESENTATION',
  OFFICE_SUPPLIES: 'OFFICE_SUPPLIES',
  COMMUNICATION: 'COMMUNICATION',
  SOFTWARE_SUBSCRIPTION: 'SOFTWARE_SUBSCRIPTION',
  RENT: 'RENT',
  UTILITIES: 'UTILITIES',
  PROFESSIONAL_SERVICES: 'PROFESSIONAL_SERVICES',
  REPAIR: 'REPAIR',
  TRAINING: 'TRAINING',
  MARKETING: 'MARKETING',
  INSURANCE: 'INSURANCE',
  BANK_FEE: 'BANK_FEE',
  OTHER: 'OTHER',
} as const;
export type ExpenseCategoryCode = (typeof ExpenseCategoryCodes)[keyof typeof ExpenseCategoryCodes];

export const DEFAULT_EXPENSE_CATEGORIES: Array<{
  code: string;
  name: string;
  receiptRequirement: string;
  businessPurposeRequired: boolean;
  prepaidEligible: boolean;
  capitalizableEligible: boolean;
  inventoryCostEligible: boolean;
  allocationRequired: boolean;
  defaultAccountingMappingKey: string;
}> = [
  { code: ExpenseCategoryCodes.TRAVEL, name: 'Travel', receiptRequirement: 'REQUIRED', businessPurposeRequired: true, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.HOTEL, name: 'Hotel', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.TAXI, name: 'Taxi', receiptRequirement: 'REQUIRED', businessPurposeRequired: true, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.FUEL, name: 'Fuel', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.MEALS, name: 'Meals', receiptRequirement: 'REQUIRED_ABOVE_THRESHOLD', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.REPRESENTATION, name: 'Representation', receiptRequirement: 'REQUIRED', businessPurposeRequired: true, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.OFFICE_SUPPLIES, name: 'Office Supplies', receiptRequirement: 'OPTIONAL', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: true, inventoryCostEligible: false, allocationRequired: true, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.COMMUNICATION, name: 'Communication', receiptRequirement: 'OPTIONAL', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: true, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.SOFTWARE_SUBSCRIPTION, name: 'Software Subscription', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: true, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: true, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.RENT, name: 'Rent', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: true, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: true, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.UTILITIES, name: 'Utilities', receiptRequirement: 'OPTIONAL', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: true, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.PROFESSIONAL_SERVICES, name: 'Professional Services', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: true, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.REPAIR, name: 'Repair', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.TRAINING, name: 'Training', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.MARKETING, name: 'Marketing', receiptRequirement: 'OPTIONAL', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'COMMERCIAL_EXPENSE' },
  { code: ExpenseCategoryCodes.INSURANCE, name: 'Insurance', receiptRequirement: 'REQUIRED', businessPurposeRequired: false, prepaidEligible: true, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.BANK_FEE, name: 'Bank Fee', receiptRequirement: 'NOT_REQUIRED', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
  { code: ExpenseCategoryCodes.OTHER, name: 'Other', receiptRequirement: 'OPTIONAL', businessPurposeRequired: false, prepaidEligible: false, capitalizableEligible: false, inventoryCostEligible: false, allocationRequired: false, defaultAccountingMappingKey: 'ADMIN_EXPENSE' },
];

export const PaymentSourceTypes = {
  EMPLOYEE_PERSONAL_FUNDS: 'EMPLOYEE_PERSONAL_FUNDS',
  EMPLOYEE_ADVANCE: 'EMPLOYEE_ADVANCE',
  CASH_DESK: 'CASH_DESK',
  BANK: 'BANK',
  CORPORATE_CARD: 'CORPORATE_CARD',
  SUPPLIER_PAYABLE: 'SUPPLIER_PAYABLE',
  OTHER: 'OTHER',
} as const;

export const ExpenseClassifications = {
  CURRENT_EXPENSE: 'CURRENT_EXPENSE',
  PREPAID_EXPENSE: 'PREPAID_EXPENSE',
  INVENTORY_COST: 'INVENTORY_COST',
  FIXED_ASSET: 'FIXED_ASSET',
  CIP: 'CIP',
  EMPLOYEE_RECEIVABLE: 'EMPLOYEE_RECEIVABLE',
  SUPPLIER_SETTLEMENT: 'SUPPLIER_SETTLEMENT',
  NONDEDUCTIBLE_EXPENSE: 'NONDEDUCTIBLE_EXPENSE',
  OTHER: 'OTHER',
} as const;

export const AllocationDriverCodes = {
  HEADCOUNT: 'HEADCOUNT',
  FTE: 'FTE',
  AREA_SQM: 'AREA_SQM',
  REVENUE: 'REVENUE',
  WORKED_HOURS: 'WORKED_HOURS',
  DIRECT_LABOR_HOURS: 'DIRECT_LABOR_HOURS',
  MACHINE_HOURS: 'MACHINE_HOURS',
  SALES_VOLUME: 'SALES_VOLUME',
  MANUAL_PERCENTAGE: 'MANUAL_PERCENTAGE',
  FIXED_WEIGHT: 'FIXED_WEIGHT',
} as const;

export const DEFAULT_ALLOCATION_DRIVERS: Array<{ code: string; name: string }> = [
  { code: AllocationDriverCodes.HEADCOUNT, name: 'Headcount' },
  { code: AllocationDriverCodes.FTE, name: 'FTE' },
  { code: AllocationDriverCodes.AREA_SQM, name: 'Area (sqm)' },
  { code: AllocationDriverCodes.REVENUE, name: 'Revenue' },
  { code: AllocationDriverCodes.WORKED_HOURS, name: 'Worked Hours' },
  { code: AllocationDriverCodes.MANUAL_PERCENTAGE, name: 'Manual Percentage' },
  { code: AllocationDriverCodes.FIXED_WEIGHT, name: 'Fixed Weight' },
];

/** Employee-side settlement register (AccountablePersonMovement, Phase
 * 15) vs. the company-side reimbursement liability register defined
 * below — kept deliberately separate (spec sections 26-27: advance/
 * expense/employee-debt vs. company-payable are different directions). */
export const EMPLOYEE_REIMBURSEMENT_REGISTER = 'EMPLOYEE_EXPENSE_REIMBURSEMENT_REGISTER';
export const ReimbursementCategories = {
  REIMBURSEMENT_DUE: 'REIMBURSEMENT_DUE',
} as const;
