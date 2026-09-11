import { HttpStatus } from '@nestjs/common';

/**
 * Consistent application error structure (section 37).
 *
 * Every domain/application-layer failure should throw an `AppError` subclass
 * (or `AppError` directly) rather than a raw Error / framework exception, so
 * the global exception filter can always produce:
 *   { code, message, details?, fieldErrors?, requestId, correlationId }
 * and never leak a raw stack trace or DB error to the client.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  DOCUMENT_ALREADY_POSTED: 'DOCUMENT_ALREADY_POSTED',
  DOCUMENT_NOT_POSTED: 'DOCUMENT_NOT_POSTED',
  CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT',
  DUPLICATE_NUMBER: 'DUPLICATE_NUMBER',
  POSTING_ERROR: 'POSTING_ERROR',
  TENANT_CONTEXT_REQUIRED: 'TENANT_CONTEXT_REQUIRED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',

  // Accounting Core (docx spec Phase 4, section 108)
  ACCOUNT_NOT_POSTABLE: 'ACCOUNT_NOT_POSTABLE',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  ACCOUNT_DIMENSION_REQUIRED: 'ACCOUNT_DIMENSION_REQUIRED',
  ACCOUNT_DIMENSION_NOT_ALLOWED: 'ACCOUNT_DIMENSION_NOT_ALLOWED',
  ACCOUNT_MAPPING_NOT_FOUND: 'ACCOUNT_MAPPING_NOT_FOUND',
  ACCOUNT_MAPPING_AMBIGUOUS: 'ACCOUNT_MAPPING_AMBIGUOUS',
  JOURNAL_NOT_BALANCED: 'JOURNAL_NOT_BALANCED',
  JOURNAL_ALREADY_POSTED: 'JOURNAL_ALREADY_POSTED',
  JOURNAL_NOT_POSTED: 'JOURNAL_NOT_POSTED',
  CURRENCY_REQUIRED: 'CURRENCY_REQUIRED',
  QUANTITY_REQUIRED: 'QUANTITY_REQUIRED',
  POSTING_DUPLICATE: 'POSTING_DUPLICATE',
  REVERSAL_NOT_ALLOWED: 'REVERSAL_NOT_ALLOWED',
  INVALID_ACCOUNT_HIERARCHY: 'INVALID_ACCOUNT_HIERARCHY',

  // Tax Engine (docx spec Phase 5, section 135)
  TAX_RULE_NOT_FOUND: 'TAX_RULE_NOT_FOUND',
  TAX_RULE_AMBIGUOUS: 'TAX_RULE_AMBIGUOUS',
  TAX_RULE_NOT_EFFECTIVE: 'TAX_RULE_NOT_EFFECTIVE',
  TAX_RULE_REPEALED: 'TAX_RULE_REPEALED',
  TAX_RATE_NOT_FOUND: 'TAX_RATE_NOT_FOUND',
  TAX_REGISTRATION_REQUIRED: 'TAX_REGISTRATION_REQUIRED',
  TAX_CATEGORY_NOT_CONFIGURED: 'TAX_CATEGORY_NOT_CONFIGURED',
  TAX_MAPPING_NOT_FOUND: 'TAX_MAPPING_NOT_FOUND',
  TAX_CALCULATION_ERROR: 'TAX_CALCULATION_ERROR',
  TAX_ROUNDING_ERROR: 'TAX_ROUNDING_ERROR',
  TAX_OVERRIDE_NOT_ALLOWED: 'TAX_OVERRIDE_NOT_ALLOWED',
  TAX_PERIOD_LOCKED: 'TAX_PERIOD_LOCKED',
  TAX_POSTING_DUPLICATE: 'TAX_POSTING_DUPLICATE',
  TAX_LEGAL_SOURCE_INVALID: 'TAX_LEGAL_SOURCE_INVALID',

  // Sales Pre-Order & Order Management (docx spec Phase 6)
  ORDER_ON_HOLD: 'ORDER_ON_HOLD',
  CREDIT_CHECK_BLOCKED: 'CREDIT_CHECK_BLOCKED',
  OFFER_EXPIRED: 'OFFER_EXPIRED',
  OFFER_NOT_ACCEPTED: 'OFFER_NOT_ACCEPTED',
  RESERVATION_EXCEEDS_REMAINING: 'RESERVATION_EXCEEDS_REMAINING',
  SHIPMENT_PLAN_EXCEEDS_REMAINING: 'SHIPMENT_PLAN_EXCEEDS_REMAINING',
  PAYMENT_SCHEDULE_MISMATCH: 'PAYMENT_SCHEDULE_MISMATCH',

  // Sales Execution (docx spec Phase 7, section 92)
  SHIPMENT_QUANTITY_EXCEEDS_REMAINING: 'SHIPMENT_QUANTITY_EXCEEDS_REMAINING',
  SHIPMENT_INSUFFICIENT_STOCK: 'SHIPMENT_INSUFFICIENT_STOCK',
  SHIPMENT_HAS_DOWNSTREAM_DOCUMENTS: 'SHIPMENT_HAS_DOWNSTREAM_DOCUMENTS',
  INVOICE_QUANTITY_EXCEEDS_SOURCE: 'INVOICE_QUANTITY_EXCEEDS_SOURCE',
  INVOICE_HAS_SETTLEMENTS: 'INVOICE_HAS_SETTLEMENTS',
  INVOICE_HAS_RETURNS: 'INVOICE_HAS_RETURNS',
  RETURN_QUANTITY_EXCEEDS_SOLD: 'RETURN_QUANTITY_EXCEEDS_SOLD',
  RETURN_ORIGINAL_DOCUMENT_REQUIRED: 'RETURN_ORIGINAL_DOCUMENT_REQUIRED',
  SALES_COGS_NOT_AVAILABLE: 'SALES_COGS_NOT_AVAILABLE',

  // Procurement & Purchase Order Management (docx spec Phase 8, section 92-93)
  REQUIREMENT_ALLOCATION_EXCEEDS_REMAINING: 'REQUIREMENT_ALLOCATION_EXCEEDS_REMAINING',
  REQUIREMENT_DEPARTMENT_MISMATCH: 'REQUIREMENT_DEPARTMENT_MISMATCH',
  SUPPLIER_NOT_ELIGIBLE: 'SUPPLIER_NOT_ELIGIBLE',
  PURCHASE_ORDER_ON_HOLD: 'PURCHASE_ORDER_ON_HOLD',
  PURCHASE_ORDER_HAS_DOWNSTREAM_LINKS: 'PURCHASE_ORDER_HAS_DOWNSTREAM_LINKS',
  SUPPLY_PEG_EXCEEDS_DEMAND: 'SUPPLY_PEG_EXCEEDS_DEMAND',
  NO_PURCHASE_PRICE_FOUND: 'NO_PURCHASE_PRICE_FOUND',

  // Purchase Execution (docx spec Phase 9, section 46)
  RECEIPT_QUANTITY_EXCEEDS_REMAINING: 'RECEIPT_QUANTITY_EXCEEDS_REMAINING',
  GOODS_RECEIPT_HAS_DOWNSTREAM_LINKS: 'GOODS_RECEIPT_HAS_DOWNSTREAM_LINKS',
  DUPLICATE_SUPPLIER_INVOICE: 'DUPLICATE_SUPPLIER_INVOICE',
  PURCHASE_INVOICE_QUANTITY_EXCEEDS_SOURCE: 'PURCHASE_INVOICE_QUANTITY_EXCEEDS_SOURCE',
  PURCHASE_INVOICE_HAS_RETURNS: 'PURCHASE_INVOICE_HAS_RETURNS',
  PURCHASE_RETURN_QUANTITY_EXCEEDS_RECEIVED: 'PURCHASE_RETURN_QUANTITY_EXCEEDS_RECEIVED',
  PURCHASE_RETURN_SOURCE_REQUIRED: 'PURCHASE_RETURN_SOURCE_REQUIRED',

  // Warehouse / Stock Engine (docx spec Phase 10, section 87)
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  NEGATIVE_STOCK_BLOCKED: 'NEGATIVE_STOCK_BLOCKED',
  BATCH_MISMATCH: 'BATCH_MISMATCH',
  BATCH_INSUFFICIENT: 'BATCH_INSUFFICIENT',
  BATCH_REQUIRED: 'BATCH_REQUIRED',
  SERIAL_REQUIRED: 'SERIAL_REQUIRED',
  SERIAL_COUNT_MISMATCH: 'SERIAL_COUNT_MISMATCH',
  SERIAL_NOT_AVAILABLE: 'SERIAL_NOT_AVAILABLE',
  SERIAL_WRONG_LOCATION: 'SERIAL_WRONG_LOCATION',
  SERIAL_DUPLICATE: 'SERIAL_DUPLICATE',
  LOCATION_INSUFFICIENT_STOCK: 'LOCATION_INSUFFICIENT_STOCK',
  TRANSFER_UNPOST_BLOCKED: 'TRANSFER_UNPOST_BLOCKED',
  TRANSFER_ALREADY_RECEIVED: 'TRANSFER_ALREADY_RECEIVED',
  TRANSFER_RECEIVE_EXCEEDS_SHIPPED: 'TRANSFER_RECEIVE_EXCEEDS_SHIPPED',
  INVENTORY_UNPOST_DEPENDENCY: 'INVENTORY_UNPOST_DEPENDENCY',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCodeType;
  readonly httpStatus: HttpStatus;
  readonly details?: unknown;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: ErrorCodeType,
    message: string,
    httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
    options?: { details?: unknown; fieldErrors?: Record<string, string[]> },
  ) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = options?.details;
    this.fieldErrors = options?.fieldErrors;
  }
}

export class ValidationAppError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST, { fieldErrors });
  }
}

export class PermissionDeniedError extends AppError {
  constructor(permission?: string) {
    super(
      ErrorCode.PERMISSION_DENIED,
      permission ? `Missing required permission: ${permission}` : 'Permission denied',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class NotFoundAppError extends AppError {
  constructor(entity: string, id?: string) {
    super(ErrorCode.NOT_FOUND, `${entity} not found${id ? `: ${id}` : ''}`, HttpStatus.NOT_FOUND);
  }
}

export class ConflictAppError extends AppError {
  constructor(message: string) {
    super(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);
  }
}

export class PeriodClosedError extends AppError {
  constructor(businessDate: string) {
    super(
      ErrorCode.PERIOD_CLOSED,
      `Period covering ${businessDate} is closed for posting`,
      HttpStatus.CONFLICT,
    );
  }
}

export class DocumentAlreadyPostedError extends AppError {
  constructor(documentId: string) {
    super(
      ErrorCode.DOCUMENT_ALREADY_POSTED,
      `Document ${documentId} is already posted`,
      HttpStatus.CONFLICT,
    );
  }
}

export class DocumentNotPostedError extends AppError {
  constructor(documentId: string) {
    super(
      ErrorCode.DOCUMENT_NOT_POSTED,
      `Document ${documentId} is not posted`,
      HttpStatus.CONFLICT,
    );
  }
}

export class ConcurrencyConflictError extends AppError {
  constructor() {
    super(
      ErrorCode.CONCURRENCY_CONFLICT,
      'The document has been changed by another user. Refresh before saving.',
      HttpStatus.CONFLICT,
    );
  }
}

export class DuplicateNumberError extends AppError {
  constructor(number: string) {
    super(ErrorCode.DUPLICATE_NUMBER, `Document number already exists: ${number}`, HttpStatus.CONFLICT);
  }
}

export class PostingError extends AppError {
  constructor(message: string, details?: unknown) {
    super(ErrorCode.POSTING_ERROR, message, HttpStatus.UNPROCESSABLE_ENTITY, { details });
  }
}

export class TenantContextRequiredError extends AppError {
  constructor() {
    super(
      ErrorCode.TENANT_CONTEXT_REQUIRED,
      'This operation requires an active tenant context',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }
}

export class JournalNotBalancedError extends AppError {
  constructor(debitTotal: string, creditTotal: string) {
    super(
      ErrorCode.JOURNAL_NOT_BALANCED,
      `Journal Entry is out of balance: debit ${debitTotal} != credit ${creditTotal}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class AccountNotPostableError extends AppError {
  constructor(code: string) {
    super(
      ErrorCode.ACCOUNT_NOT_POSTABLE,
      `Account ${code} is a structural/reporting node and cannot receive postings`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class AccountInactiveError extends AppError {
  constructor(code: string) {
    super(ErrorCode.ACCOUNT_INACTIVE, `Account ${code} is inactive`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class AccountDimensionRequiredError extends AppError {
  constructor(accountCode: string, dimensionCode: string) {
    super(
      ErrorCode.ACCOUNT_DIMENSION_REQUIRED,
      `Account ${accountCode} requires dimension '${dimensionCode}'`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class AccountMappingNotFoundError extends AppError {
  constructor(mappingKey: string) {
    super(
      ErrorCode.ACCOUNT_MAPPING_NOT_FOUND,
      `Accounting mapping '${mappingKey}' is not configured`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class AccountMappingAmbiguousError extends AppError {
  constructor(mappingKey: string) {
    super(
      ErrorCode.ACCOUNT_MAPPING_AMBIGUOUS,
      `Accounting mapping '${mappingKey}' resolves to more than one equal-priority account`,
      HttpStatus.CONFLICT,
    );
  }
}

export class JournalAlreadyPostedError extends AppError {
  constructor(id: string) {
    super(ErrorCode.JOURNAL_ALREADY_POSTED, `Journal Entry ${id} is already posted`, HttpStatus.CONFLICT);
  }
}

export class JournalNotPostedError extends AppError {
  constructor(id: string) {
    super(ErrorCode.JOURNAL_NOT_POSTED, `Journal Entry ${id} is not posted`, HttpStatus.CONFLICT);
  }
}

export class PostingDuplicateError extends AppError {
  constructor(sourceDocumentType: string, sourceDocumentId: string) {
    super(
      ErrorCode.POSTING_DUPLICATE,
      `${sourceDocumentType} ${sourceDocumentId} already has an active posting generation`,
      HttpStatus.CONFLICT,
    );
  }
}

export class ReversalNotAllowedError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.REVERSAL_NOT_ALLOWED, reason, HttpStatus.CONFLICT);
  }
}

export class TaxRuleNotFoundError extends AppError {
  constructor(details: string) {
    super(ErrorCode.TAX_RULE_NOT_FOUND, `No applicable tax rule found: ${details}`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class TaxRuleAmbiguousError extends AppError {
  constructor(details: string) {
    super(
      ErrorCode.TAX_RULE_AMBIGUOUS,
      `More than one equal-priority tax rule matches: ${details}`,
      HttpStatus.CONFLICT,
    );
  }
}

export class TaxCategoryNotConfiguredError extends AppError {
  constructor(productId: string) {
    super(
      ErrorCode.TAX_CATEGORY_NOT_CONFIGURED,
      `Product ${productId} has no tax category configured for this date`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class TaxPostingDuplicateError extends AppError {
  constructor(sourceDocumentType: string, sourceDocumentId: string) {
    super(
      ErrorCode.TAX_POSTING_DUPLICATE,
      `${sourceDocumentType} ${sourceDocumentId} already has an active tax posting generation`,
      HttpStatus.CONFLICT,
    );
  }
}

export class TaxOverrideNotAllowedError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.TAX_OVERRIDE_NOT_ALLOWED, reason, HttpStatus.FORBIDDEN);
  }
}

export class OrderOnHoldError extends AppError {
  constructor(holdTypes: string[]) {
    super(ErrorCode.ORDER_ON_HOLD, `Order is on hold: ${holdTypes.join(', ')}`, HttpStatus.CONFLICT);
  }
}

export class CreditCheckBlockedError extends AppError {
  constructor(explanation: string) {
    super(ErrorCode.CREDIT_CHECK_BLOCKED, `Credit check blocked confirmation: ${explanation}`, HttpStatus.CONFLICT);
  }
}

export class OfferExpiredError extends AppError {
  constructor(offerId: string) {
    super(ErrorCode.OFFER_EXPIRED, `Commercial offer ${offerId} has expired`, HttpStatus.CONFLICT);
  }
}

export class ReservationExceedsRemainingError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.RESERVATION_EXCEEDS_REMAINING,
      `Requested reservation quantity ${requested} exceeds remaining orderable quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ShipmentPlanExceedsRemainingError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.SHIPMENT_PLAN_EXCEEDS_REMAINING,
      `Planned quantity ${requested} exceeds remaining fulfillable quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class PaymentScheduleMismatchError extends AppError {
  constructor(expected: string, actual: string) {
    super(
      ErrorCode.PAYMENT_SCHEDULE_MISMATCH,
      `Payment schedule totals ${actual}, does not match order total ${expected}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ShipmentQuantityExceedsRemainingError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.SHIPMENT_QUANTITY_EXCEEDS_REMAINING,
      `Shipment quantity ${requested} exceeds remaining order quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ShipmentInsufficientStockError extends AppError {
  constructor(productId: string, available: string, requested: string) {
    super(
      ErrorCode.SHIPMENT_INSUFFICIENT_STOCK,
      `Insufficient stock for product ${productId}: available ${available}, requested ${requested}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ShipmentHasDownstreamDocumentsError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.SHIPMENT_HAS_DOWNSTREAM_DOCUMENTS, reason, HttpStatus.CONFLICT);
  }
}

export class InvoiceQuantityExceedsSourceError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.INVOICE_QUANTITY_EXCEEDS_SOURCE,
      `Invoice quantity ${requested} exceeds remaining invoiceable quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class InvoiceHasSettlementsError extends AppError {
  constructor(invoiceId: string) {
    super(ErrorCode.INVOICE_HAS_SETTLEMENTS, `Invoice ${invoiceId} has settlement allocations and cannot be unposted`, HttpStatus.CONFLICT);
  }
}

export class InvoiceHasReturnsError extends AppError {
  constructor(invoiceId: string) {
    super(ErrorCode.INVOICE_HAS_RETURNS, `Invoice ${invoiceId} has posted returns and cannot be unposted`, HttpStatus.CONFLICT);
  }
}

export class ReturnQuantityExceedsSoldError extends AppError {
  constructor(maxReturnable: string, requested: string) {
    super(
      ErrorCode.RETURN_QUANTITY_EXCEEDS_SOLD,
      `Return quantity ${requested} exceeds returnable quantity ${maxReturnable}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class RequirementAllocationExceedsRemainingError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.REQUIREMENT_ALLOCATION_EXCEEDS_REMAINING,
      `Allocation quantity ${requested} exceeds remaining requirement quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class RequirementDepartmentMismatchError extends AppError {
  constructor() {
    super(
      ErrorCode.REQUIREMENT_DEPARTMENT_MISMATCH,
      'Selected purchase requirements belong to different departments — only requirements from the same department can be combined into one purchase order',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class SupplierNotEligibleError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.SUPPLIER_NOT_ELIGIBLE, `Supplier is not eligible: ${reason}`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class PurchaseOrderOnHoldError extends AppError {
  constructor(holdTypes: string[]) {
    super(
      ErrorCode.PURCHASE_ORDER_ON_HOLD,
      `Purchase order has active hold(s): ${holdTypes.join(', ')}`,
      HttpStatus.CONFLICT,
    );
  }
}

export class PurchaseOrderHasDownstreamLinksError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.PURCHASE_ORDER_HAS_DOWNSTREAM_LINKS, reason, HttpStatus.CONFLICT);
  }
}

export class SupplyPegExceedsDemandError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.SUPPLY_PEG_EXCEEDS_DEMAND,
      `Peg quantity ${requested} exceeds remaining unpegged demand ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class NoPurchasePriceFoundError extends AppError {
  constructor(productCode: string) {
    super(
      ErrorCode.NO_PURCHASE_PRICE_FOUND,
      `No purchase price found for product ${productCode} at this date/quantity/supplier`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ReceiptQuantityExceedsRemainingError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.RECEIPT_QUANTITY_EXCEEDS_REMAINING,
      `Receipt quantity ${requested} exceeds remaining supplier order quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class GoodsReceiptHasDownstreamLinksError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.GOODS_RECEIPT_HAS_DOWNSTREAM_LINKS, reason, HttpStatus.CONFLICT);
  }
}

export class DuplicateSupplierInvoiceError extends AppError {
  constructor(supplierInvoiceNumber: string) {
    super(
      ErrorCode.DUPLICATE_SUPPLIER_INVOICE,
      `Supplier invoice ${supplierInvoiceNumber} already exists for this supplier`,
      HttpStatus.CONFLICT,
    );
  }
}

export class PurchaseInvoiceQuantityExceedsSourceError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.PURCHASE_INVOICE_QUANTITY_EXCEEDS_SOURCE,
      `Invoice quantity ${requested} exceeds remaining invoiceable quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class PurchaseInvoiceHasReturnsError extends AppError {
  constructor(invoiceId: string) {
    super(ErrorCode.PURCHASE_INVOICE_HAS_RETURNS, `Invoice ${invoiceId} has posted returns and cannot be unposted`, HttpStatus.CONFLICT);
  }
}

export class PurchaseReturnQuantityExceedsReceivedError extends AppError {
  constructor(maxReturnable: string, requested: string) {
    super(
      ErrorCode.PURCHASE_RETURN_QUANTITY_EXCEEDS_RECEIVED,
      `Return quantity ${requested} exceeds returnable quantity ${maxReturnable}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class PurchaseReturnSourceRequiredError extends AppError {
  constructor() {
    super(
      ErrorCode.PURCHASE_RETURN_SOURCE_REQUIRED,
      'A purchase return line must reference a source receipt or invoice line, or the return must carry an explicit price',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class InsufficientStockError extends AppError {
  constructor(productCode: string, available: string, requested: string) {
    super(
      ErrorCode.INSUFFICIENT_STOCK,
      `Insufficient stock for product ${productCode}: available ${available}, requested ${requested}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class NegativeStockBlockedError extends AppError {
  constructor(warehouseCode: string, productCode: string, available: string, requested: string) {
    super(
      ErrorCode.NEGATIVE_STOCK_BLOCKED,
      `Warehouse ${warehouseCode} has only ${available} units of ${productCode} available; ${requested} units were requested`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class BatchMismatchError extends AppError {
  constructor(batchNumber: string, productCode: string) {
    super(ErrorCode.BATCH_MISMATCH, `Batch ${batchNumber} does not belong to product ${productCode}`, HttpStatus.BAD_REQUEST);
  }
}

export class BatchInsufficientError extends AppError {
  constructor(batchNumber: string, available: string, requested: string) {
    super(
      ErrorCode.BATCH_INSUFFICIENT,
      `Batch ${batchNumber} has only ${available} units available; ${requested} units were requested`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class BatchRequiredError extends AppError {
  constructor(productCode: string) {
    super(ErrorCode.BATCH_REQUIRED, `Product ${productCode} requires a batch to be specified`, HttpStatus.BAD_REQUEST);
  }
}

export class SerialRequiredError extends AppError {
  constructor(productCode: string) {
    super(ErrorCode.SERIAL_REQUIRED, `Product ${productCode} requires serial numbers to be specified`, HttpStatus.BAD_REQUEST);
  }
}

export class SerialCountMismatchError extends AppError {
  constructor(expected: number, actual: number) {
    super(
      ErrorCode.SERIAL_COUNT_MISMATCH,
      actual < expected ? `${expected - actual} serial numbers are still required` : `${actual - expected} too many serial numbers were provided`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class SerialNotAvailableError extends AppError {
  constructor(serialNumber: string, status: string) {
    super(ErrorCode.SERIAL_NOT_AVAILABLE, `Serial ${serialNumber} is not available (current status: ${status})`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class SerialWrongLocationError extends AppError {
  constructor(serialNumber: string, currentWarehouseCode: string, requestedWarehouseCode: string) {
    super(
      ErrorCode.SERIAL_WRONG_LOCATION,
      `Serial ${serialNumber} is currently located in Warehouse ${currentWarehouseCode} and cannot be issued from ${requestedWarehouseCode}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class SerialDuplicateError extends AppError {
  constructor(serialNumber: string) {
    super(ErrorCode.SERIAL_DUPLICATE, `Serial ${serialNumber} has already been received and is not available for re-receipt`, HttpStatus.CONFLICT);
  }
}

export class LocationInsufficientStockError extends AppError {
  constructor(locationCode: string, available: string, requested: string) {
    super(
      ErrorCode.LOCATION_INSUFFICIENT_STOCK,
      `Warehouse location ${locationCode} does not contain sufficient stock: available ${available}, requested ${requested}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class TransferUnpostBlockedError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.TRANSFER_UNPOST_BLOCKED, reason, HttpStatus.CONFLICT);
  }
}

export class TransferAlreadyReceivedError extends AppError {
  constructor() {
    super(ErrorCode.TRANSFER_ALREADY_RECEIVED, 'This transfer has already been fully received', HttpStatus.CONFLICT);
  }
}

export class TransferReceiveExceedsShippedError extends AppError {
  constructor(remaining: string, requested: string) {
    super(
      ErrorCode.TRANSFER_RECEIVE_EXCEEDS_SHIPPED,
      `Receive quantity ${requested} exceeds remaining in-transit quantity ${remaining}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class InventoryUnpostDependencyError extends AppError {
  constructor(reason: string) {
    super(ErrorCode.INVENTORY_UNPOST_DEPENDENCY, reason, HttpStatus.CONFLICT);
  }
}
