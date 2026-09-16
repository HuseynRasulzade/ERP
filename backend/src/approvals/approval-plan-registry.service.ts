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
}
