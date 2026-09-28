-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "fixed_asset_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_useful_life_months" INTEGER,
    "default_depreciation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "default_residual_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capitalization_threshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "componentization_allowed" BOOLEAN NOT NULL DEFAULT false,
    "revaluation_model" TEXT NOT NULL DEFAULT 'COST_MODEL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_acquisition_candidates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "supplier_id" TEXT,
    "product_id" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "currency_id" TEXT,
    "transaction_amount" DECIMAL(18,2) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capitalizable_amount" DECIMAL(18,2),
    "candidate_type" TEXT NOT NULL DEFAULT 'PURCHASE',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assigned_cip_project_id" TEXT,
    "assigned_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_acquisition_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_investment_projects" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "project_type" TEXT,
    "start_date" DATE NOT NULL,
    "planned_completion_date" DATE,
    "department_id" TEXT,
    "responsible_person_id" TEXT,
    "location_warehouse_id" TEXT,
    "currency_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "target_asset_count" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "capital_investment_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_investment_costs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "cost_component" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "effective_date" DATE NOT NULL,
    "capitalized" BOOLEAN NOT NULL DEFAULT false,
    "capitalized_asset_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "capital_investment_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "asset_number" TEXT,
    "inventory_number" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT NOT NULL,
    "parent_asset_id" TEXT,
    "cip_project_id" TEXT,
    "acquisition_date" DATE NOT NULL,
    "acceptance_date" DATE,
    "commissioning_date" DATE,
    "depreciation_start_date" DATE,
    "disposal_date" DATE,
    "location_warehouse_id" TEXT,
    "department_id" TEXT,
    "responsible_person_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACQUISITION',
    "ownership_type" TEXT NOT NULL DEFAULT 'OWNED',
    "serial_number" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "useful_life_months" INTEGER,
    "depreciation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "residual_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depreciation_start_rule" TEXT NOT NULL DEFAULT 'FIRST_DAY_NEXT_MONTH',
    "initial_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "from_department_id" TEXT,
    "to_department_id" TEXT,
    "from_location_warehouse_id" TEXT,
    "to_location_warehouse_id" TEXT,
    "from_responsible_person_id" TEXT,
    "to_responsible_person_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_policy_changes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "old_useful_life_months" INTEGER,
    "new_useful_life_months" INTEGER,
    "old_residual_value" DECIMAL(18,2),
    "new_residual_value" DECIMAL(18,2),
    "old_depreciation_method" TEXT,
    "new_depreciation_method" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_policy_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_modernizations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'FIXED_ASSET_MODERNIZATION',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "asset_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "new_useful_life_months" INTEGER,
    "new_residual_value" DECIMAL(18,2),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_modernizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_impairments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'FIXED_ASSET_IMPAIRMENT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "asset_id" TEXT NOT NULL,
    "impairment_type" TEXT NOT NULL DEFAULT 'IMPAIRMENT',
    "carrying_amount_before" DECIMAL(18,2) NOT NULL,
    "recoverable_amount" DECIMAL(18,2) NOT NULL,
    "impairment_amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_impairments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_disposals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'FIXED_ASSET_DISPOSAL',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "asset_id" TEXT NOT NULL,
    "disposal_type" TEXT NOT NULL,
    "proceeds" DECIMAL(18,2),
    "disposal_costs" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "source_sales_invoice_id" TEXT,
    "reason" TEXT,
    "gross_cost_at_disposal" DECIMAL(18,2),
    "accumulated_depreciation_at_disposal" DECIMAL(18,2),
    "gain_loss" DECIMAL(18,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "valuation_book" TEXT NOT NULL DEFAULT 'ACCOUNTING_BOOK',
    "run_type" TEXT NOT NULL DEFAULT 'PERIODIC',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "asset_count" INTEGER NOT NULL DEFAULT 0,
    "calculated_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_entry_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "initiated_by" TEXT,
    "errors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciation_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "opening_nbv" DECIMAL(18,2) NOT NULL,
    "depreciation_amount" DECIMAL(18,2) NOT NULL,
    "closing_nbv" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "fixed_asset_depreciation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_inventory_counts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_department_id" TEXT,
    "scope_warehouse_id" TEXT,
    "scope_category_id" TEXT,
    "count_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_inventory_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "result_type" TEXT NOT NULL,
    "expected_location_warehouse_id" TEXT,
    "found_location_warehouse_id" TEXT,
    "expected_responsible_person_id" TEXT,
    "found_responsible_person_id" TEXT,
    "condition" TEXT,
    "notes" TEXT,
    "resolution_status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution_document_type" TEXT,
    "resolution_document_id" TEXT,

    CONSTRAINT "fixed_asset_inventory_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_opening_balances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "opening_date" DATE NOT NULL,
    "original_cost" DECIMAL(18,2) NOT NULL,
    "accumulated_depreciation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impairment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remaining_useful_life_months" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_categories_tenant_id_code_key" ON "fixed_asset_categories"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "fixed_asset_acquisition_candidates_organization_id_status_idx" ON "fixed_asset_acquisition_candidates"("organization_id", "status");

-- CreateIndex
CREATE INDEX "fixed_asset_acquisition_candidates_source_document_type_sou_idx" ON "fixed_asset_acquisition_candidates"("source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "capital_investment_projects_organization_id_status_idx" ON "capital_investment_projects"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capital_investment_projects_tenant_id_code_key" ON "capital_investment_projects"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "capital_investment_costs_tenant_id_project_id_idx" ON "capital_investment_costs"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "fixed_assets_organization_id_status_idx" ON "fixed_assets"("organization_id", "status");

-- CreateIndex
CREATE INDEX "fixed_assets_organization_id_category_id_idx" ON "fixed_assets"("organization_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_tenant_id_asset_number_key" ON "fixed_assets"("tenant_id", "asset_number");

-- CreateIndex
CREATE INDEX "fixed_asset_transfers_tenant_id_asset_id_idx" ON "fixed_asset_transfers"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "fixed_asset_policy_changes_tenant_id_asset_id_idx" ON "fixed_asset_policy_changes"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "fixed_asset_modernizations_organization_id_asset_id_idx" ON "fixed_asset_modernizations"("organization_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_modernizations_tenant_id_number_key" ON "fixed_asset_modernizations"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "fixed_asset_impairments_organization_id_asset_id_idx" ON "fixed_asset_impairments"("organization_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_impairments_tenant_id_number_key" ON "fixed_asset_impairments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "fixed_asset_disposals_organization_id_asset_id_idx" ON "fixed_asset_disposals"("organization_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_disposals_tenant_id_number_key" ON "fixed_asset_disposals"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciation_runs_organization_id_period_valuat_key" ON "fixed_asset_depreciation_runs"("organization_id", "period", "valuation_book");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciation_lines_tenant_id_asset_id_idx" ON "fixed_asset_depreciation_lines"("tenant_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciation_lines_run_id_asset_id_key" ON "fixed_asset_depreciation_lines"("run_id", "asset_id");

-- CreateIndex
CREATE INDEX "fixed_asset_inventory_results_tenant_id_count_id_idx" ON "fixed_asset_inventory_results"("tenant_id", "count_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_opening_balances_asset_id_key" ON "fixed_asset_opening_balances"("asset_id");

-- AddForeignKey
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_acquisition_candidates" ADD CONSTRAINT "fixed_asset_acquisition_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_acquisition_candidates" ADD CONSTRAINT "fixed_asset_acquisition_candidates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_acquisition_candidates" ADD CONSTRAINT "fixed_asset_acquisition_candidates_assigned_cip_project_id_fkey" FOREIGN KEY ("assigned_cip_project_id") REFERENCES "capital_investment_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_acquisition_candidates" ADD CONSTRAINT "fixed_asset_acquisition_candidates_assigned_asset_id_fkey" FOREIGN KEY ("assigned_asset_id") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_investment_projects" ADD CONSTRAINT "capital_investment_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_investment_projects" ADD CONSTRAINT "capital_investment_projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_investment_costs" ADD CONSTRAINT "capital_investment_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_investment_costs" ADD CONSTRAINT "capital_investment_costs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "capital_investment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fixed_asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_cip_project_id_fkey" FOREIGN KEY ("cip_project_id") REFERENCES "capital_investment_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transfers" ADD CONSTRAINT "fixed_asset_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transfers" ADD CONSTRAINT "fixed_asset_transfers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_policy_changes" ADD CONSTRAINT "fixed_asset_policy_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_policy_changes" ADD CONSTRAINT "fixed_asset_policy_changes_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_modernizations" ADD CONSTRAINT "fixed_asset_modernizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_modernizations" ADD CONSTRAINT "fixed_asset_modernizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_modernizations" ADD CONSTRAINT "fixed_asset_modernizations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_impairments" ADD CONSTRAINT "fixed_asset_impairments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_impairments" ADD CONSTRAINT "fixed_asset_impairments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_impairments" ADD CONSTRAINT "fixed_asset_impairments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_disposals" ADD CONSTRAINT "fixed_asset_disposals_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_runs" ADD CONSTRAINT "fixed_asset_depreciation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_runs" ADD CONSTRAINT "fixed_asset_depreciation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_lines" ADD CONSTRAINT "fixed_asset_depreciation_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_lines" ADD CONSTRAINT "fixed_asset_depreciation_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "fixed_asset_depreciation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_lines" ADD CONSTRAINT "fixed_asset_depreciation_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_inventory_counts" ADD CONSTRAINT "fixed_asset_inventory_counts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_inventory_counts" ADD CONSTRAINT "fixed_asset_inventory_counts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_inventory_results" ADD CONSTRAINT "fixed_asset_inventory_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_inventory_results" ADD CONSTRAINT "fixed_asset_inventory_results_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "fixed_asset_inventory_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_inventory_results" ADD CONSTRAINT "fixed_asset_inventory_results_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_opening_balances" ADD CONSTRAINT "fixed_asset_opening_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_opening_balances" ADD CONSTRAINT "fixed_asset_opening_balances_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
