-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_type" TEXT NOT NULL DEFAULT 'MONTHLY',
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "payment_date" DATE,
    "work_time_period_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculated_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "reopened_at" TIMESTAMP(3),
    "reopen_reason" TEXT,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_compensation_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "compensation_type" TEXT NOT NULL DEFAULT 'REGULAR',
    "pay_basis" TEXT NOT NULL,
    "base_salary" DECIMAL(14,2),
    "hourly_rate" DECIMAL(10,4),
    "daily_rate" DECIMAL(12,2),
    "currency_id" TEXT,
    "fte_basis" TEXT NOT NULL DEFAULT 'ACTUAL_ASSIGNED_SALARY',
    "salary_grade" TEXT,
    "source_document" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_compensation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_earning_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calculation_strategy" TEXT NOT NULL,
    "taxable_income" BOOLEAN NOT NULL DEFAULT true,
    "social_insurance_base" BOOLEAN NOT NULL DEFAULT true,
    "unemployment_base" BOOLEAN NOT NULL DEFAULT true,
    "medical_insurance_base" BOOLEAN NOT NULL DEFAULT true,
    "average_earnings_inclusion" BOOLEAN NOT NULL DEFAULT true,
    "gross_pay_inclusion" BOOLEAN NOT NULL DEFAULT true,
    "employer_cost_inclusion" BOOLEAN NOT NULL DEFAULT true,
    "accounting_mapping_key" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_earning_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_deduction_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'STATUTORY',
    "tax_treatment" TEXT NOT NULL DEFAULT 'POST_TAX',
    "calculation_method" TEXT NOT NULL,
    "base_definition" TEXT,
    "percentage" DECIMAL(7,4),
    "fixed_amount" DECIMAL(14,2),
    "cap_amount" DECIMAL(14,2),
    "floor_amount" DECIMAL(14,2),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "consent_required" BOOLEAN NOT NULL DEFAULT false,
    "accounting_mapping_key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_deduction_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_legal_rule_sets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AZ',
    "rule_code" TEXT NOT NULL,
    "legal_source" TEXT,
    "article_reference" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "rule_version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approved_by" TEXT,
    "published_date" DATE,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_legal_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_tax_brackets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rule_code" TEXT NOT NULL,
    "regime" TEXT,
    "from_amount" DECIMAL(14,2) NOT NULL,
    "to_amount" DECIMAL(14,2),
    "base_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(7,4) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "payroll_tax_brackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_contribution_brackets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contribution_type" TEXT NOT NULL,
    "payer_type" TEXT NOT NULL,
    "regime" TEXT,
    "threshold_from" DECIMAL(14,2) NOT NULL,
    "threshold_to" DECIMAL(14,2),
    "fixed_component" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "percentage" DECIMAL(7,4) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "payroll_contribution_brackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_tax_reliefs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "formula" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "combinability" TEXT NOT NULL DEFAULT 'ADDITIVE',
    "main_workplace_required" BOOLEAN NOT NULL DEFAULT false,
    "legal_reference" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "payroll_tax_reliefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_tax_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "tax_residency" TEXT NOT NULL DEFAULT 'RESIDENT',
    "main_workplace" BOOLEAN NOT NULL DEFAULT true,
    "sector_category" TEXT,
    "exemption_codes" JSONB,
    "statutory_relief_reference" TEXT,
    "tax_regime" TEXT NOT NULL DEFAULT 'STANDARD',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "supporting_document" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_variable_inputs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "earning_code" TEXT NOT NULL,
    "payroll_period_id" TEXT,
    "amount" DECIMAL(14,2),
    "percentage" DECIMAL(7,4),
    "quantity" DECIMAL(10,2),
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "approval_status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "effective_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_variable_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_execution_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "creditor" TEXT,
    "execution_document_reference" TEXT,
    "calculation_method" TEXT NOT NULL,
    "percentage" DECIMAL(7,4),
    "fixed_amount" DECIMAL(14,2),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "cap_amount" DECIMAL(14,2),
    "protected_minimum_rule" TEXT,
    "carry_forward_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_execution_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_average_earnings_calculations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "calculation_type" TEXT NOT NULL,
    "reference_period_start" DATE NOT NULL,
    "reference_period_end" DATE NOT NULL,
    "included_earnings" JSONB,
    "excluded_earnings" JSONB,
    "substitution_periods" JSONB,
    "adjustment_coefficient" DECIMAL(7,3),
    "average_monthly" DECIMAL(14,2),
    "average_daily" DECIMAL(14,4),
    "paid_days" DECIMAL(6,2),
    "result_amount" DECIMAL(14,2),
    "source_result_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_average_earnings_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_calculation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payroll_period_id" TEXT NOT NULL,
    "run_type" TEXT NOT NULL DEFAULT 'REGULAR',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "initiated_by" TEXT,
    "employees_processed" INTEGER NOT NULL DEFAULT 0,
    "employees_failed" INTEGER NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_taxes" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_employer_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_calculation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_calculation_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "payroll_period_id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_income" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employee_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employer_contributions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employer_total_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "superseded_by_id" TEXT,
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_calculation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_result_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "result_id" TEXT NOT NULL,
    "calculation_code" TEXT NOT NULL,
    "line_type" TEXT NOT NULL,
    "quantity" DECIMAL(10,2),
    "rate" DECIMAL(10,4),
    "base_amount" DECIMAL(14,2),
    "multiplier" DECIMAL(6,3),
    "amount" DECIMAL(14,2) NOT NULL,
    "taxable_flags" JSONB,
    "source_input" TEXT,
    "source_rule" TEXT,
    "calculation_sequence" INTEGER NOT NULL,
    "explanation" TEXT,

    CONSTRAINT "payroll_result_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_recalculation_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "earliest_affected_period_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "payroll_recalculation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_errors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "employment_id" TEXT,
    "calculation_code" TEXT,
    "error_code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ERROR',
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payment_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payroll_period_id" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "bank_account_id" TEXT,
    "cash_desk_id" TEXT,
    "payment_date" DATE NOT NULL,
    "total_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_payment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payment_allocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_batch_id" TEXT,
    "payment_document_type" TEXT,
    "payment_document_id" TEXT,
    "employment_id" TEXT NOT NULL,
    "payroll_period_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocation_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ALLOCATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_periods_organization_id_status_idx" ON "payroll_periods"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_organization_id_year_month_key" ON "payroll_periods"("organization_id", "year", "month");

-- CreateIndex
CREATE INDEX "payroll_compensation_assignments_employment_id_effective_fr_idx" ON "payroll_compensation_assignments"("employment_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_earning_definitions_tenant_id_code_key" ON "payroll_earning_definitions"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_deduction_definitions_tenant_id_code_key" ON "payroll_deduction_definitions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "payroll_legal_rule_sets_tenant_id_rule_code_effective_from_idx" ON "payroll_legal_rule_sets"("tenant_id", "rule_code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_legal_rule_sets_tenant_id_rule_code_rule_version_key" ON "payroll_legal_rule_sets"("tenant_id", "rule_code", "rule_version");

-- CreateIndex
CREATE INDEX "payroll_tax_brackets_tenant_id_rule_code_effective_from_idx" ON "payroll_tax_brackets"("tenant_id", "rule_code", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_contribution_brackets_tenant_id_contribution_type_p_idx" ON "payroll_contribution_brackets"("tenant_id", "contribution_type", "payer_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_tax_reliefs_tenant_id_code_key" ON "payroll_tax_reliefs"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "payroll_tax_profiles_employment_id_effective_from_idx" ON "payroll_tax_profiles"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_variable_inputs_employment_id_effective_date_idx" ON "payroll_variable_inputs"("employment_id", "effective_date");

-- CreateIndex
CREATE INDEX "payroll_execution_orders_employment_id_status_idx" ON "payroll_execution_orders"("employment_id", "status");

-- CreateIndex
CREATE INDEX "payroll_average_earnings_calculations_employment_id_calcula_idx" ON "payroll_average_earnings_calculations"("employment_id", "calculation_type");

-- CreateIndex
CREATE INDEX "payroll_calculation_runs_payroll_period_id_status_idx" ON "payroll_calculation_runs"("payroll_period_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_calculation_results_superseded_by_id_key" ON "payroll_calculation_results"("superseded_by_id");

-- CreateIndex
CREATE INDEX "payroll_calculation_results_payroll_period_id_status_idx" ON "payroll_calculation_results"("payroll_period_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_calculation_results_employment_id_payroll_period_id_key" ON "payroll_calculation_results"("employment_id", "payroll_period_id", "version");

-- CreateIndex
CREATE INDEX "payroll_result_lines_result_id_calculation_sequence_idx" ON "payroll_result_lines"("result_id", "calculation_sequence");

-- CreateIndex
CREATE INDEX "payroll_recalculation_requests_employment_id_status_idx" ON "payroll_recalculation_requests"("employment_id", "status");

-- CreateIndex
CREATE INDEX "payroll_errors_calculation_run_id_resolved_idx" ON "payroll_errors"("calculation_run_id", "resolved");

-- CreateIndex
CREATE INDEX "payroll_payment_batches_organization_id_status_idx" ON "payroll_payment_batches"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payroll_payment_allocations_employment_id_payroll_period_id_idx" ON "payroll_payment_allocations"("employment_id", "payroll_period_id");

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_compensation_assignments" ADD CONSTRAINT "payroll_compensation_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_earning_definitions" ADD CONSTRAINT "payroll_earning_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_deduction_definitions" ADD CONSTRAINT "payroll_deduction_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_legal_rule_sets" ADD CONSTRAINT "payroll_legal_rule_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_tax_brackets" ADD CONSTRAINT "payroll_tax_brackets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_contribution_brackets" ADD CONSTRAINT "payroll_contribution_brackets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_tax_reliefs" ADD CONSTRAINT "payroll_tax_reliefs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_tax_profiles" ADD CONSTRAINT "payroll_tax_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_variable_inputs" ADD CONSTRAINT "payroll_variable_inputs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_execution_orders" ADD CONSTRAINT "payroll_execution_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_average_earnings_calculations" ADD CONSTRAINT "payroll_average_earnings_calculations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_runs" ADD CONSTRAINT "payroll_calculation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_runs" ADD CONSTRAINT "payroll_calculation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_runs" ADD CONSTRAINT "payroll_calculation_runs_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_results" ADD CONSTRAINT "payroll_calculation_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_results" ADD CONSTRAINT "payroll_calculation_results_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_results" ADD CONSTRAINT "payroll_calculation_results_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "payroll_calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculation_results" ADD CONSTRAINT "payroll_calculation_results_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "payroll_calculation_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_result_lines" ADD CONSTRAINT "payroll_result_lines_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "payroll_calculation_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_recalculation_requests" ADD CONSTRAINT "payroll_recalculation_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_errors" ADD CONSTRAINT "payroll_errors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_errors" ADD CONSTRAINT "payroll_errors_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "payroll_calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batches_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment_allocations" ADD CONSTRAINT "payroll_payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payment_allocations" ADD CONSTRAINT "payroll_payment_allocations_payment_batch_id_fkey" FOREIGN KEY ("payment_batch_id") REFERENCES "payroll_payment_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
