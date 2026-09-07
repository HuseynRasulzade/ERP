import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';

import { StructuralValidationService } from './structural-validation.service';
import { OrganizationAccessService } from './organization-access.service';

import { OrganizationService } from './organization.service';
import { OrganizationController } from './organization.controller';

import { BranchService } from './branch.service';
import { BranchController } from './branch.controller';

import { DepartmentService } from './department.service';
import { DepartmentController } from './department.controller';

import { ResponsiblePersonService } from './responsible-person.service';
import { ResponsiblePersonController } from './responsible-person.controller';

import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';

import { CashboxService } from './cashbox.service';
import { CashboxController } from './cashbox.controller';

import { BankAccountService } from './bank-account.service';
import { BankAccountController } from './bank-account.controller';

import { AccountingPolicyService } from './accounting-policy.service';
import { AccountingPolicyController } from './accounting-policy.controller';

import { TaxProfileService } from './tax-profile.service';
import { TaxProfileController } from './tax-profile.controller';

/**
 * Phase 1 — Organization & Business Structure. A single Nest module
 * (one service+controller pair per entity) sitting entirely on top of the
 * Phase 0 foundation: reuses AuditService, PrismaService's transaction
 * helper, the AppError model, and the JWT/RBAC guard chain wired globally
 * in AppModule — nothing here duplicates Phase 0 infrastructure.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    OrganizationController,
    BranchController,
    DepartmentController,
    ResponsiblePersonController,
    WarehouseController,
    CashboxController,
    BankAccountController,
    AccountingPolicyController,
    TaxProfileController,
  ],
  providers: [
    StructuralValidationService,
    OrganizationAccessService,
    OrganizationService,
    BranchService,
    DepartmentService,
    ResponsiblePersonService,
    WarehouseService,
    CashboxService,
    BankAccountService,
    AccountingPolicyService,
    TaxProfileService,
  ],
  exports: [
    OrganizationAccessService,
    OrganizationService,
    AccountingPolicyService,
    TaxProfileService,
    StructuralValidationService,
  ],
})
export class OrgStructureModule {}
