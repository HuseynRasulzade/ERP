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
