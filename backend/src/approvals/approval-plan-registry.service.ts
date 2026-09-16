import { Injectable } from '@nestjs/common';
import { ApprovalPlanProvider } from './approval-plan.interface';

/**
 * Strategy registry for approval plan providers — same shape as
 * DocumentFrameworkRegistry, kept as its own separate registry since
 * approval and posting are independent axes (approving a document never
 * posts it).
 */
@Injectable()
export class ApprovalPlanRegistryService {
  private readonly providers = new Map<string, ApprovalPlanProvider>();

  register(provider: ApprovalPlanProvider): void {
    this.providers.set(provider.documentType, provider);
  }

  get(documentType: string): ApprovalPlanProvider | undefined {
    return this.providers.get(documentType);
  }

  /** Every document type with a registered approval plan — used by the
   * pending-approvals inbox (approval.service.ts) to scan across all of
   * them rather than one document type at a time. */
  listDocumentTypes(): string[] {
    return Array.from(this.providers.keys());
  }
}
