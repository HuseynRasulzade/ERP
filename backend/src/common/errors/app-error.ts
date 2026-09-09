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
