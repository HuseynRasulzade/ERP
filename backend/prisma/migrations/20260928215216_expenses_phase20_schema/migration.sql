-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_cost_center_id" TEXT,
    "department_id" TEXT,
    "responsible_person_id" TEXT,
    "effective_from" DATE NOT NULL DEFAULT '1970-01-01',
    "effective_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accounting_dimension_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_accounting_mapping_key" TEXT,
    "vat_treatment_profile" TEXT,
    "receipt_requirement" TEXT NOT NULL DEFAULT 'OPTIONAL',
    "receipt_required_threshold" DECIMAL(14,2),
    "business_purpose_required" BOOLEAN NOT NULL DEFAULT false,
    "allowed_payment_methods" JSONB,
    "prepaid_eligible" BOOLEAN NOT NULL DEFAULT false,
    "capitalizable_eligible" BOOLEAN NOT NULL DEFAULT false,
    "inventory_cost_eligible" BOOLEAN NOT NULL DEFAULT false,
    "allocation_required" BOOLEAN NOT NULL DEFAULT false,
    "approval_profile" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "expense_category_id" TEXT,
    "employee_grade" TEXT,
    "position_id" TEXT,
    "department_id" TEXT,
    "travel_type" TEXT,
    "country" TEXT,
    "city" TEXT,
    "payment_method" TEXT,
    "currency_id" TEXT,
    "max_amount" DECIMAL(14,2),
    "max_amount_period" TEXT,
    "receipt_required_override" TEXT,
    "business_purpose_required" BOOLEAN,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'EXPENSE_CLAIM',
    "number" TEXT,
    "employment_id" TEXT NOT NULL,
    "claim_date" DATE NOT NULL,
    "expense_period_start" DATE,
    "expense_period_end" DATE,
    "currency_id" TEXT,
    "total_claimed_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_approved_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advance_applied_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reimbursement_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employee_debt_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "claim_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "responsible_manager_id" TEXT,
    "comment" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "posting_status" TEXT NOT NULL DEFAULT 'NOT_POSTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claim_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "expense_date" DATE NOT NULL,
    "expense_category_id" TEXT NOT NULL,
    "merchant" TEXT,
    "supplier_id" TEXT,
    "supplier_tax_id" TEXT,
    "description" TEXT,
    "business_purpose" TEXT,
    "transaction_currency_id" TEXT NOT NULL,
    "transaction_amount" DECIMAL(14,2) NOT NULL,
    "exchange_rate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recoverable_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "nonrecoverable_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approved_amount" DECIMAL(14,2),
    "payment_source_type" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "project_id" TEXT,
    "department_id" TEXT,
    "allocation_rule_id" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "prepaid_candidate" BOOLEAN NOT NULL DEFAULT false,
    "capitalizable_candidate" BOOLEAN NOT NULL DEFAULT false,
    "policy_status" TEXT NOT NULL DEFAULT 'OK',
    "tax_status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "classification" TEXT,
    "tax_deductible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_line_id" TEXT NOT NULL,
    "file_id" TEXT,
    "document_type" TEXT NOT NULL,
    "document_number" TEXT,
    "supplier" TEXT,
    "supplier_tax_id" TEXT,
    "document_date" DATE,
    "amount" DECIMAL(14,2),
    "currency_id" TEXT,
    "tax_amount" DECIMAL(14,2),
    "attachment_hash" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validation_status" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',

    CONSTRAINT "expense_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_tax_assessments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_line_id" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "vat_present" BOOLEAN NOT NULL DEFAULT false,
    "recoverable" BOOLEAN NOT NULL DEFAULT false,
    "nonrecoverable" BOOLEAN NOT NULL DEFAULT false,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "recoverable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "nonrecoverable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_document_status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "deductible_for_tax" BOOLEAN NOT NULL DEFAULT true,
    "source_rule" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_tax_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_allocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_claim_line_id" TEXT,
    "source_cost_allocation_line_id" TEXT,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "allocation_method" TEXT NOT NULL,
    "allocation_percentage" DECIMAL(7,4),
    "allocation_quantity" DECIMAL(14,4),
    "allocated_amount" DECIMAL(14,2) NOT NULL,
    "effective_period_year" INTEGER,
    "effective_period_month" INTEGER,
    "source_driver_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepaid_expenses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_claim_line_id" TEXT,
    "expense_category_id" TEXT NOT NULL,
    "original_amount" DECIMAL(14,2) NOT NULL,
    "currency_id" TEXT,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "recognition_start_date" DATE NOT NULL,
    "recognition_end_date" DATE NOT NULL,
    "allocation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE_BY_MONTH',
    "cost_center_id" TEXT,
    "project_id" TEXT,
    "recognized_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "prepaid_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepaid_expense_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "prepaid_expense_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "planned_recognition_amount" DECIMAL(14,2) NOT NULL,
    "recognized_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "posting_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prepaid_expense_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepaid_recognition_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "errors" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "prepaid_recognition_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_drivers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_driver_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "allocation_driver_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_driver_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_cost_center_id" TEXT NOT NULL,
    "expense_category_filter" JSONB,
    "allocation_type" TEXT NOT NULL,
    "allocation_driver_id" TEXT,
    "targets" JSONB NOT NULL,
    "allocation_frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "rounding_rule" TEXT NOT NULL DEFAULT 'LARGEST_REMAINDER',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "source_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "allocated_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "residual" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "posting_batch" TEXT,
    "errors" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "cost_allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocation_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "allocation_rule_id" TEXT NOT NULL,
    "source_cost_center_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "driver_value" DECIMAL(18,4),
    "percentage" DECIMAL(7,4),
    "allocated_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "adjustment_type" TEXT NOT NULL,
    "source_claim_line_id" TEXT,
    "source_prepaid_expense_id" TEXT,
    "from_value" JSONB,
    "to_value" JSONB,
    "amount" DECIMAL(14,2),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "expense_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "reopened_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_budgets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "cost_center_id" TEXT,
    "expense_category_id" TEXT,
    "project_id" TEXT,
    "currency_id" TEXT,
    "budget_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "revised_budget_amount" DECIMAL(16,2),
    "committed_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_centers_organization_id_active_idx" ON "cost_centers"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_organization_id_code_key" ON "cost_centers"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_tenant_id_code_key" ON "expense_categories"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "expense_policies_tenant_id_expense_category_id_effective_fr_idx" ON "expense_policies"("tenant_id", "expense_category_id", "effective_from");

-- CreateIndex
CREATE INDEX "expense_claims_organization_id_claim_status_idx" ON "expense_claims"("organization_id", "claim_status");

-- CreateIndex
CREATE INDEX "expense_claims_employment_id_idx" ON "expense_claims"("employment_id");

-- CreateIndex
CREATE INDEX "expense_claim_lines_claim_id_idx" ON "expense_claim_lines"("claim_id");

-- CreateIndex
CREATE INDEX "expense_claim_lines_expense_category_id_idx" ON "expense_claim_lines"("expense_category_id");

-- CreateIndex
CREATE INDEX "expense_claim_lines_cost_center_id_idx" ON "expense_claim_lines"("cost_center_id");

-- CreateIndex
CREATE INDEX "expense_receipts_claim_line_id_idx" ON "expense_receipts"("claim_line_id");

-- CreateIndex
CREATE INDEX "expense_receipts_tenant_id_supplier_document_number_documen_idx" ON "expense_receipts"("tenant_id", "supplier", "document_number", "document_date", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "expense_tax_assessments_claim_line_id_key" ON "expense_tax_assessments"("claim_line_id");

-- CreateIndex
CREATE INDEX "expense_allocations_source_claim_line_id_idx" ON "expense_allocations"("source_claim_line_id");

-- CreateIndex
CREATE INDEX "expense_allocations_target_type_target_id_idx" ON "expense_allocations"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "prepaid_expenses_organization_id_status_idx" ON "prepaid_expenses"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prepaid_expense_schedules_prepaid_expense_id_period_year_pe_key" ON "prepaid_expense_schedules"("prepaid_expense_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "prepaid_recognition_runs_organization_id_period_year_period_idx" ON "prepaid_recognition_runs"("organization_id", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_drivers_tenant_id_code_key" ON "allocation_drivers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_driver_values_allocation_driver_id_period_year_p_key" ON "allocation_driver_values"("allocation_driver_id", "period_year", "period_month", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "allocation_rules_organization_id_source_cost_center_id_idx" ON "allocation_rules"("organization_id", "source_cost_center_id");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_rules_tenant_id_code_key" ON "allocation_rules"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "cost_allocation_runs_organization_id_period_year_period_mon_idx" ON "cost_allocation_runs"("organization_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "cost_allocation_lines_run_id_idx" ON "cost_allocation_lines"("run_id");

-- CreateIndex
CREATE INDEX "expense_adjustments_organization_id_adjustment_type_idx" ON "expense_adjustments"("organization_id", "adjustment_type");

-- CreateIndex
CREATE UNIQUE INDEX "expense_periods_organization_id_year_month_key" ON "expense_periods"("organization_id", "year", "month");

-- CreateIndex
CREATE INDEX "expense_budgets_organization_id_period_year_period_month_idx" ON "expense_budgets"("organization_id", "period_year", "period_month");

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_cost_center_id_fkey" FOREIGN KEY ("parent_cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_policies" ADD CONSTRAINT "expense_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "expense_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_claim_line_id_fkey" FOREIGN KEY ("claim_line_id") REFERENCES "expense_claim_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_tax_assessments" ADD CONSTRAINT "expense_tax_assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_tax_assessments" ADD CONSTRAINT "expense_tax_assessments_claim_line_id_fkey" FOREIGN KEY ("claim_line_id") REFERENCES "expense_claim_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_expenses" ADD CONSTRAINT "prepaid_expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_expenses" ADD CONSTRAINT "prepaid_expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_expense_schedules" ADD CONSTRAINT "prepaid_expense_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_expense_schedules" ADD CONSTRAINT "prepaid_expense_schedules_prepaid_expense_id_fkey" FOREIGN KEY ("prepaid_expense_id") REFERENCES "prepaid_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_recognition_runs" ADD CONSTRAINT "prepaid_recognition_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_recognition_runs" ADD CONSTRAINT "prepaid_recognition_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_drivers" ADD CONSTRAINT "allocation_drivers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_driver_values" ADD CONSTRAINT "allocation_driver_values_allocation_driver_id_fkey" FOREIGN KEY ("allocation_driver_id") REFERENCES "allocation_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_runs" ADD CONSTRAINT "cost_allocation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_runs" ADD CONSTRAINT "cost_allocation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_lines" ADD CONSTRAINT "cost_allocation_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_lines" ADD CONSTRAINT "cost_allocation_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "cost_allocation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_adjustments" ADD CONSTRAINT "expense_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_adjustments" ADD CONSTRAINT "expense_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_periods" ADD CONSTRAINT "expense_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_periods" ADD CONSTRAINT "expense_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_budgets" ADD CONSTRAINT "expense_budgets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_budgets" ADD CONSTRAINT "expense_budgets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
