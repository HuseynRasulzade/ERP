import { HttpStatus } from '@nestjs/common';
import { AppError, ErrorCodeType } from '../common/errors/app-error';

/**
 * Phase 12 specific, actionable errors (spec section 114 — "Inventory
 * count failed" alone is never enough). Codes are module-local string
 * constants (the shared `ErrorCode` catalog is a closed `as const` map
 * other phases append to in parallel; keeping these here avoids a merge
 * hotspot while producing the exact same `{ code, message }` envelope via
 * the global exception filter).
 */
export const InventoryCountErrorCode = {
  INVENTORY_COUNT_NO_SCOPE: 'INVENTORY_COUNT_NO_SCOPE',
  INVENTORY_COUNT_LOCKED: 'INVENTORY_COUNT_LOCKED',
  INVENTORY_COUNT_LOCK_CONFLICT: 'INVENTORY_COUNT_LOCK_CONFLICT',
  INVENTORY_COUNT_INVALID_STATE: 'INVENTORY_COUNT_INVALID_STATE',
  INVENTORY_COUNT_SNAPSHOT_EXISTS: 'INVENTORY_COUNT_SNAPSHOT_EXISTS',
  INVENTORY_COUNT_SCOPE_IMMUTABLE: 'INVENTORY_COUNT_SCOPE_IMMUTABLE',
  INVENTORY_COUNT_SERIAL_DUPLICATE: 'INVENTORY_COUNT_SERIAL_DUPLICATE',
  INVENTORY_COUNT_DUPLICATE_ENTRY: 'INVENTORY_COUNT_DUPLICATE_ENTRY',
  INVENTORY_COUNT_OUT_OF_SCOPE: 'INVENTORY_COUNT_OUT_OF_SCOPE',
  INVENTORY_COUNT_UNIT_CONVERSION: 'INVENTORY_COUNT_UNIT_CONVERSION',
  INVENTORY_COUNT_RECOUNT_PENDING: 'INVENTORY_COUNT_RECOUNT_PENDING',
  INVENTORY_COUNT_STALE: 'INVENTORY_COUNT_STALE',
  INVENTORY_COUNT_COSTING_UNRESOLVED: 'INVENTORY_COUNT_COSTING_UNRESOLVED',
  INVENTORY_COUNT_INCOMPLETE: 'INVENTORY_COUNT_INCOMPLETE',
  INVENTORY_COUNT_UNRESOLVED_VARIANCES: 'INVENTORY_COUNT_UNRESOLVED_VARIANCES',
  INVENTORY_COUNT_SEGREGATION_OF_DUTIES: 'INVENTORY_COUNT_SEGREGATION_OF_DUTIES',
  INVENTORY_COUNT_NOT_RECONCILED: 'INVENTORY_COUNT_NOT_RECONCILED',
  INVENTORY_COUNT_IMPORT_INVALID: 'INVENTORY_COUNT_IMPORT_INVALID',
  INVENTORY_COUNT_WAREHOUSE_ACCESS: 'INVENTORY_COUNT_WAREHOUSE_ACCESS',
} as const;

class InventoryCountError extends AppError {
  constructor(code: keyof typeof InventoryCountErrorCode, message: string, status: HttpStatus, details?: unknown) {
    super(code as unknown as ErrorCodeType, message, status, details !== undefined ? { details } : undefined);
  }
}

export class CountScopeMissingError extends InventoryCountError {
  constructor() {
    super('INVENTORY_COUNT_NO_SCOPE', 'Count session cannot start because no inventory scope has been defined.', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class CountLockedError extends InventoryCountError {
  constructor(what: string, sessionNumber: string) {
    super('INVENTORY_COUNT_LOCKED', `${what} is locked for inventory count session ${sessionNumber}.`, HttpStatus.CONFLICT);
  }
}

export class CountLockConflictError extends InventoryCountError {
  constructor(what: string, sessionNumber: string) {
    super('INVENTORY_COUNT_LOCK_CONFLICT', `${what} is already locked by inventory count ${sessionNumber}.`, HttpStatus.CONFLICT);
  }
}

export class CountInvalidStateError extends InventoryCountError {
  constructor(message: string) {
    super('INVENTORY_COUNT_INVALID_STATE', message, HttpStatus.CONFLICT);
  }
}

export class CountSnapshotExistsError extends InventoryCountError {
  constructor(version: number) {
    super('INVENTORY_COUNT_SNAPSHOT_EXISTS', `A stock snapshot (version ${version}) already exists for this session; recreate it only through a controlled restart.`, HttpStatus.CONFLICT);
  }
}

export class CountScopeImmutableError extends InventoryCountError {
  constructor() {
    super('INVENTORY_COUNT_SCOPE_IMMUTABLE', 'Inventory count scope cannot be changed after the session has started; cancel/reopen the session for a controlled scope revision.', HttpStatus.CONFLICT);
  }
}

export class CountSerialDuplicateError extends InventoryCountError {
  constructor(serial: string) {
    super('INVENTORY_COUNT_SERIAL_DUPLICATE', `Serial ${serial} was counted twice.`, HttpStatus.CONFLICT);
  }
}

export class CountDuplicateEntryError extends InventoryCountError {
  constructor() {
    super('INVENTORY_COUNT_DUPLICATE_ENTRY', 'This product/location has already been counted on this session and the duplicate-entry policy blocks a second entry; edit the existing entry instead.', HttpStatus.CONFLICT);
  }
}

export class CountOutOfScopeError extends InventoryCountError {
  constructor(message: string) {
    super('INVENTORY_COUNT_OUT_OF_SCOPE', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class CountUnitConversionError extends InventoryCountError {
  constructor(unitCode: string, baseUnitCode: string) {
    super('INVENTORY_COUNT_UNIT_CONVERSION', `No unit conversion is configured from ${unitCode} to the product base unit ${baseUnitCode}.`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class CountRecountPendingError extends InventoryCountError {
  constructor(lines: number) {
    super('INVENTORY_COUNT_RECOUNT_PENDING', `Inventory adjustment cannot be posted because recount is still pending for ${lines} variance lines.`, HttpStatus.CONFLICT);
  }
}

export class CountStaleError extends InventoryCountError {
  constructor(details?: unknown) {
    super('INVENTORY_COUNT_STALE', 'Inventory count result is stale because new stock movements occurred after variance approval.', HttpStatus.CONFLICT, details);
  }
}

export class CountCostingUnresolvedError extends InventoryCountError {
  constructor(productCode: string) {
    super('INVENTORY_COUNT_COSTING_UNRESOLVED', `Shortage adjustment cannot be costed because inventory costing for the item ${productCode} is unresolved.`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class CountIncompleteError extends InventoryCountError {
  constructor(message: string, details?: unknown) {
    super('INVENTORY_COUNT_INCOMPLETE', message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class CountUnresolvedVariancesError extends InventoryCountError {
  constructor(message: string, details?: unknown) {
    super('INVENTORY_COUNT_UNRESOLVED_VARIANCES', message, HttpStatus.CONFLICT, details);
  }
}

export class CountSegregationOfDutiesError extends InventoryCountError {
  constructor(message: string) {
    super('INVENTORY_COUNT_SEGREGATION_OF_DUTIES', message, HttpStatus.FORBIDDEN);
  }
}

export class CountNotReconciledError extends InventoryCountError {
  constructor(message: string, details?: unknown) {
    super('INVENTORY_COUNT_NOT_RECONCILED', message, HttpStatus.CONFLICT, details);
  }
}

export class CountImportInvalidError extends InventoryCountError {
  constructor(details: unknown) {
    super('INVENTORY_COUNT_IMPORT_INVALID', 'Inventory count import rejected: one or more rows are invalid (nothing was imported).', HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class CountWarehouseAccessError extends InventoryCountError {
  constructor(warehouseCode: string) {
    super('INVENTORY_COUNT_WAREHOUSE_ACCESS', `You are not assigned to count warehouse ${warehouseCode} in this inventory count.`, HttpStatus.FORBIDDEN);
  }
}
