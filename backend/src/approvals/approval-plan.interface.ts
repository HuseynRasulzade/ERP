import { PrismaTransactionClient } from '../prisma/prisma.service';

export type ApprovalStepType = 'PROCUREMENT_OFFICER' | 'DEPARTMENT_HEAD' | 'DIRECTOR' | 'FINANCE' | 'ACCOUNTING' | 'WAREHOUSE_SUPERVISOR';

export interface ApprovalStepPlanItem {
  sequence: number;
  stepType: ApprovalStepType;
  /** SKIPPED steps are recorded (for visibility) but never block the chain
   * or require a resolvable approver — used when a step type is
   * structurally inapplicable to this specific document instance (e.g. no
   * department to resolve a DEPARTMENT_HEAD step against). */
  skipped?: boolean;
}

/**
 * Small purpose-built strategy contract — this is the extension seam a
 * future increment plugs into (Goods Receipt/Purchase Invoice/Sales Order
 * approval) without touching ApprovalService itself. Deliberately NOT the
 * full Phase 26 condition-DSL/route-DAG model — each provider hardcodes its
 * own plan/eligibility logic for its one document type.
 */
export interface ApprovalPlanProvider {
  readonly documentType: string;

  /** Loads the document row (with whatever includes the provider needs for
   * planning/eligibility), so ApprovalService itself never branches on
   * documentType. Must include `organizationId`. */
  loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient): Promise<any>;

  /** Persists the document's `approvalStatus` column. */
  setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient): Promise<void>;

  /** Computes which approval steps this specific document instance needs,
   * in order. Called once, right after the document is created. */
  planSteps(tenantId: string, organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]>;

  /** Is `userId` eligible to act on this pending step for this document? */
  resolveApprover(
    tenantId: string,
    organizationId: string,
    stepType: ApprovalStepType,
    document: any,
    userId: string,
    tx: PrismaTransactionClient,
  ): Promise<boolean>;

  /** The document's creator — used for the creator-cannot-approve-their-own-document guard. */
  getCreatedBy(document: any): string | null;
}
