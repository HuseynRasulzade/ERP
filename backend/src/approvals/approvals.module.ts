import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApprovalPlanRegistryService } from './approval-plan-registry.service';
import { ApprovalService } from './approval.service';
import { ApprovalStepsController } from './approval-steps.controller';

@Module({
  imports: [AuditModule],
  controllers: [ApprovalStepsController],
  providers: [ApprovalPlanRegistryService, ApprovalService],
  exports: [ApprovalPlanRegistryService, ApprovalService],
})
export class ApprovalsModule {}
