import Decimal from 'decimal.js';
import { RegisterMovementInput } from '../document-framework/document-posting-handler.interface';

export const EXPENSE_MOVEMENT_REGISTER = 'EXPENSE_MOVEMENT_REGISTER';

const CLASSIFICATION_TO_MOVEMENT_TYPE: Record<string, string> = {
  CURRENT_EXPENSE: 'CURRENT_EXPENSE',
  PREPAID_EXPENSE: 'PREPAID_CREATE',
  FIXED_ASSET: 'CAPITALIZATION',
  CIP: 'CAPITALIZATION',
  INVENTORY_COST: 'CURRENT_EXPENSE',
  NONDEDUCTIBLE_EXPENSE: 'CURRENT_EXPENSE',
  OTHER: 'CURRENT_EXPENSE',
};

/**
 * ExpenseMovementRegisterService (docx spec Phase 20 section 101-102) —
 * the SEVENTH reuse of this codebase's generic RegisterMovement Truth
 * Engine (after Stock/Cash/Bank/FixedAsset/WorkTime/PayrollLiability).
 * Pure computation only — `ExpenseClaimPostingHandler.buildMovements`
 * hands these to `DocumentPostingService`, which persists them
 * generically inside the posting transaction. A `SUPPLIER_SETTLEMENT`-
 * classified line writes NOTHING here (spec sections 97-98: never
 * recognize an expense a source document already recognized).
 */
export function buildExpenseMovements(
  claim: { id: string; organizationId: string; employmentId: string },
  lines: Array<{
    id: string;
    expenseDate: Date;
    expenseCategoryId: string;
    costCenterId: string | null;
    projectId: string | null;
    departmentId: string | null;
    approvedAmount: Decimal | string | null;
    recoverableVat: Decimal | string;
    nonrecoverableVat: Decimal | string;
    classification: string | null;
  }>,
): RegisterMovementInput[] {
  const movements: RegisterMovementInput[] = [];
  for (const line of lines) {
    if (line.classification === 'SUPPLIER_SETTLEMENT') continue;
    const approvedAmount = new Decimal(line.approvedAmount?.toString() ?? '0');
    if (approvedAmount.lte(0)) continue;

    const movementType = CLASSIFICATION_TO_MOVEMENT_TYPE[line.classification ?? 'CURRENT_EXPENSE'] ?? 'CURRENT_EXPENSE';
    const recoverableTax = new Decimal(line.recoverableVat.toString());
    const nonrecoverableTax = new Decimal(line.nonrecoverableVat.toString());
    const netAmount = approvedAmount.minus(recoverableTax).minus(nonrecoverableTax);

    movements.push({
      registerCode: EXPENSE_MOVEMENT_REGISTER,
      recorderLineId: line.id,
      businessDate: line.expenseDate,
      movementType,
      dimensions: {
        organizationId: claim.organizationId,
        employmentId: claim.employmentId,
        expenseCategoryId: line.expenseCategoryId,
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        departmentId: line.departmentId,
      },
      resources: {
        expenseAmount: movementType === 'CURRENT_EXPENSE' ? netAmount.toString() : '0',
        prepaidAmount: movementType === 'PREPAID_CREATE' ? netAmount.toString() : '0',
        capitalizedAmount: movementType === 'CAPITALIZATION' ? netAmount.toString() : '0',
        recoverableTax: recoverableTax.toString(),
        nonrecoverableTax: nonrecoverableTax.toString(),
      },
    });
  }
  return movements;
}
