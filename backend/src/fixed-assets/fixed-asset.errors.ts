import { HttpStatus } from '@nestjs/common';
import { AppError, ErrorCode } from '../common/errors/app-error';

/**
 * Fixed-asset domain errors (spec section 145): every message names the
 * asset / amount / period involved — never a bare "operation failed".
 */
export class FixedAssetInvalidStateError extends AppError {
  constructor(message: string) {
    super(ErrorCode.FIXED_ASSET_INVALID_STATE, message, HttpStatus.CONFLICT);
  }
}

export class FixedAssetCostIncompleteError extends AppError {
  constructor(assetNumber: string, action: string) {
    super(
      ErrorCode.FIXED_ASSET_COST_INCOMPLETE,
      `Asset ${assetNumber} cannot be ${action} because initial cost formation is incomplete.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class CandidateAlreadyProcessedError extends AppError {
  constructor(candidateRef: string, status: string) {
    super(
      ErrorCode.FIXED_ASSET_CANDIDATE_ALREADY_PROCESSED,
      `Acquisition candidate ${candidateRef} has already been processed (status ${status}).`,
      HttpStatus.CONFLICT,
    );
  }
}

export class CipBalanceExceededError extends AppError {
  constructor(requested: string, remaining: string) {
    super(
      ErrorCode.FIXED_ASSET_CIP_BALANCE_EXCEEDED,
      `Capitalization amount of ${requested} exceeds remaining CIP balance of ${remaining}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class CipResidualError extends AppError {
  constructor(projectCode: string, residual: string) {
    super(
      ErrorCode.FIXED_ASSET_CIP_RESIDUAL,
      `CIP project ${projectCode} cannot be closed: unexplained residual balance of ${residual} remains. Capitalize or expense it first.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class FixedAssetPolicyViolationError extends AppError {
  constructor(message: string) {
    super(ErrorCode.FIXED_ASSET_POLICY_VIOLATION, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class FixedAssetReversalBlockedError extends AppError {
  constructor(message: string) {
    super(ErrorCode.FIXED_ASSET_REVERSAL_BLOCKED, message, HttpStatus.CONFLICT);
  }
}

export class DepreciationDuplicateError extends AppError {
  constructor(message: string) {
    super(ErrorCode.FIXED_ASSET_DEPRECIATION_DUPLICATE, message, HttpStatus.CONFLICT);
  }
}

export class DepreciationStaleError extends AppError {
  constructor(message: string) {
    super(ErrorCode.FIXED_ASSET_DEPRECIATION_STALE, message, HttpStatus.CONFLICT);
  }
}

export class DepreciationNotFinalizedError extends AppError {
  constructor(message: string) {
    super(ErrorCode.FIXED_ASSET_DEPRECIATION_NOT_FINALIZED, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class NegativeNbvError extends AppError {
  constructor(message: string) {
    super(ErrorCode.FIXED_ASSET_NEGATIVE_NBV, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
