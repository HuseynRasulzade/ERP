-- CreateTable
CREATE TABLE "fixed_asset_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_useful_life_months" INTEGER,
    "default_depreciation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "default_residual_value" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "default_residual_percent" DECIMAL(9,4),
    "capitalization_threshold" DECIMAL(20,4),
    "accounting_mapping_profile" TEXT,
    "tax_category" TEXT,
    "componentization_allowed" BOOLEAN NOT NULL DEFAULT false,
    "revaluation_model" TEXT NOT NULL DEFAULT 'COST_MODEL',
    "grouping_policy" TEXT NOT NULL DEFAULT 'INDIVIDUAL_ASSET',
    "default_expense_type" TEXT NOT NULL DEFAULT 'ADMINISTRATIVE',
    "default_depreciation_start_rule" TEXT,
    "default_partial_period_rule" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "category_id" TEXT,
    "book_code" TEXT NOT NULL DEFAULT 'ACCOUNTING_BOOK',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "min_capitalization_threshold" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "min_useful_life_months" INTEGER NOT NULL DEFAULT 12,
    "non_capitalizable_cost_components" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "depreciation_start_rule" TEXT NOT NULL DEFAULT 'FIRST_DAY_NEXT_MONTH',
    "partial_period_rule" TEXT NOT NULL DEFAULT 'FULL_MONTH',
    "rounding_precision" INTEGER NOT NULL DEFAULT 2,
    "suspension_depreciation_policy" TEXT NOT NULL DEFAULT 'PAUSE_DEPRECIATION',
    "held_for_sale_depreciates" BOOLEAN NOT NULL DEFAULT false,
    "modernization_depreciates" BOOLEAN NOT NULL DEFAULT true,
    "transfer_expense_rule" TEXT NOT NULL DEFAULT 'PERIOD_END_ASSIGNMENT',
    "impairment_reversal_allowed" BOOLEAN NOT NULL DEFAULT true,
    "require_prior_period_depreciation_for_disposal" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_locations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_acquisition_candidates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number" TEXT,
    "source_key" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "source_document_number" TEXT,
    "source_date" DATE NOT NULL,
    "supplier_id" TEXT,
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "currency_id" TEXT,
    "transaction_amount" DECIMAL(20,4) NOT NULL,
    "base_amount" DECIMAL(20,4) NOT NULL,
    "tax_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "non_recoverable_tax_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "capitalizable_amount" DECIMAL(20,4) NOT NULL,
    "candidate_type" TEXT NOT NULL,
    "cost_component" TEXT NOT NULL DEFAULT 'PURCHASE_PRICE',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "decision" TEXT,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "policy_recommendation" TEXT,
    "gl_recognized" BOOLEAN NOT NULL DEFAULT true,
    "expense_journal_entry_id" TEXT,
    "assigned_cip_project_id" TEXT,
    "assigned_asset_id" TEXT,
    "split_from_candidate_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_asset_acquisition_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_investment_projects" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "project_type" TEXT NOT NULL DEFAULT 'NEW_ASSET',
    "start_date" DATE NOT NULL,
    "planned_completion_date" DATE,
    "department_id" TEXT,
    "responsible_person_id" TEXT,
    "location_id" TEXT,
    "currency_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "target_asset_count" INTEGER,
    "target_asset_id" TEXT,
    "budget_amount" DECIMAL(20,4),
    "comment" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "capital_investment_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_investment_costs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cip_project_id" TEXT NOT NULL,
    "cost_component" TEXT NOT NULL,
    "movement_kind" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "base_amount" DECIMAL(20,4) NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "candidate_id" TEXT,
    "asset_id" TEXT,
    "department_id" TEXT,
    "journal_entry_id" TEXT,
    "reversal_of_id" TEXT,
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
    "asset_number" TEXT NOT NULL,
    "inventory_number" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT NOT NULL,
    "parent_asset_id" TEXT,
    "component_group_id" TEXT,
    "component_type" TEXT,
    "component_sequence" INTEGER,
    "grouping_type" TEXT NOT NULL DEFAULT 'INDIVIDUAL_ASSET',
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "acquisition_date" DATE,
    "acceptance_date" DATE,
    "commissioning_date" DATE,
    "depreciation_start_date" DATE,
    "disposal_date" DATE,
    "branch_id" TEXT,
    "department_id" TEXT,
    "location_id" TEXT,
    "responsible_person_id" TEXT,
    "cost_center_id" TEXT,
    "project_id" TEXT,
    "expense_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACQUISITION',
    "ownership_type" TEXT NOT NULL DEFAULT 'OWNED',
    "serial_number" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "useful_life_months" INTEGER,
    "remaining_useful_life_months" INTEGER,
    "depreciation_method" TEXT,
    "residual_value" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "depreciation_rate" DECIMAL(9,4),
    "initial_cost" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "accumulated_depreciation" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "impairment_balance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "revaluation_balance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "carrying_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "tax_book_reference" TEXT,
    "cip_project_id" TEXT,
    "acquisition_source_type" TEXT,
    "created_from_inventory_result_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_cost_components" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "cost_component" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "candidate_id" TEXT,
    "cip_project_id" TEXT,
    "cip_cost_id" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "source_document_line_id" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'INITIAL_COST',
    "modernization_document_id" TEXT,
    "recognized" BOOLEAN NOT NULL DEFAULT false,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_cost_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_book_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "book_code" TEXT NOT NULL DEFAULT 'ACCOUNTING_BOOK',
    "effective_date" DATE NOT NULL,
    "effective_period" TEXT NOT NULL,
    "useful_life_months" INTEGER,
    "remaining_life_months" INTEGER,
    "residual_value" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "depreciation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "depreciation_rate" DECIMAL(9,4),
    "depreciation_start_rule" TEXT NOT NULL,
    "partial_period_rule" TEXT NOT NULL,
    "cost_basis_override" DECIMAL(20,4),
    "change_reason" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_book_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "branch_id" TEXT,
    "department_id" TEXT,
    "location_id" TEXT,
    "responsible_person_id" TEXT,
    "cost_center_id" TEXT,
    "project_id" TEXT,
    "expense_type" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_parameter_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "parameter_code" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "effective_date" DATE NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_parameter_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "book_code" TEXT NOT NULL DEFAULT 'ACCOUNTING_BOOK',
    "movement_type" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "period" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "cost_increase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "cost_decrease" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "depreciation_increase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "depreciation_decrease" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "impairment_increase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "impairment_decrease" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "revaluation_increase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "revaluation_decrease" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "quantity_change" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "department_id" TEXT,
    "location_id" TEXT,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "journal_entry_id" TEXT,
    "reversal_of_movement_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fixed_asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "description" TEXT,
    "reason" TEXT,
    "operation_kind" TEXT,
    "valuation_source" TEXT,
    "approval_reference" TEXT,
    "counterparty_id" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "cip_project_id" TEXT,
    "journal_entry_id" TEXT,
    "book_code" TEXT NOT NULL DEFAULT 'ACCOUNTING_BOOK',
    "payload" JSONB,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "reversal_journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "deletion_mark" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_document_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "cost_before" DECIMAL(20,4),
    "accumulated_depreciation_before" DECIMAL(20,4),
    "impairment_before" DECIMAL(20,4),
    "revaluation_before" DECIMAL(20,4),
    "carrying_amount_before" DECIMAL(20,4),
    "carrying_amount_after" DECIMAL(20,4),
    "amount" DECIMAL(20,4),
    "recoverable_amount" DECIMAL(20,4),
    "fair_value" DECIMAL(20,4),
    "proceeds" DECIMAL(20,4),
    "disposal_costs" DECIMAL(20,4),
    "gain_loss" DECIMAL(20,4),
    "share" DECIMAL(20,10),
    "quantity" DECIMAL(20,6),
    "useful_life_before" INTEGER,
    "useful_life_after" INTEGER,
    "remaining_life_before" INTEGER,
    "remaining_life_after" INTEGER,
    "residual_before" DECIMAL(20,4),
    "residual_after" DECIMAL(20,4),
    "method_before" TEXT,
    "method_after" TEXT,
    "status_before" TEXT,
    "status_after" TEXT,
    "from_branch_id" TEXT,
    "to_branch_id" TEXT,
    "from_department_id" TEXT,
    "to_department_id" TEXT,
    "from_location_id" TEXT,
    "to_location_id" TEXT,
    "from_responsible_person_id" TEXT,
    "to_responsible_person_id" TEXT,
    "from_cost_center_id" TEXT,
    "to_cost_center_id" TEXT,
    "details" JSONB,

    CONSTRAINT "fixed_asset_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number" TEXT,
    "period" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "book_code" TEXT NOT NULL DEFAULT 'ACCOUNTING_BOOK',
    "run_type" TEXT NOT NULL DEFAULT 'PERIODIC',
    "run_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "initiated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "asset_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "calculated_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "posting_batch_id" TEXT,
    "reversal_journal_entry_id" TEXT,
    "errors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciation_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "book_code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "error_code" TEXT,
    "error_message" TEXT,
    "opening_cost" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "opening_accumulated_depreciation" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "opening_impairment" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "opening_nbv" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "residual_value" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER,
    "remaining_life_before" INTEGER,
    "depreciation_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "closing_accumulated_depreciation" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "closing_nbv" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "method" TEXT,
    "proration_factor" DECIMAL(12,8),
    "department_id" TEXT,
    "cost_center_id" TEXT,
    "project_id" TEXT,
    "expense_type" TEXT,
    "expense_account_id" TEXT,
    "accumulated_account_id" TEXT,
    "basis_sequence" BIGINT,
    "movement_id" TEXT,
    "posted_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_depreciation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciation_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "book_code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "last_run_id" TEXT,
    "finalized_at" TIMESTAMP(3),
    "finalized_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_depreciation_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_inventory_counts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number" TEXT,
    "count_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "branch_id" TEXT,
    "location_id" TEXT,
    "department_id" TEXT,
    "responsible_person_id" TEXT,
    "category_id" TEXT,
    "comment" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fixed_asset_inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_inventory_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "scanned_code" TEXT,
    "expected_location_id" TEXT,
    "expected_responsible_person_id" TEXT,
    "found_location_id" TEXT,
    "found_responsible_person_id" TEXT,
    "physically_found" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "resolution_status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolution_document_type" TEXT,
    "resolution_document_id" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "scanned_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_asset_inventory_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fixed_asset_categories_tenant_id_organization_id_active_idx" ON "fixed_asset_categories"("tenant_id", "organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_categories_tenant_id_code_key" ON "fixed_asset_categories"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "fixed_asset_policies_tenant_id_organization_id_category_id__idx" ON "fixed_asset_policies"("tenant_id", "organization_id", "category_id", "book_code", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_locations_tenant_id_organization_id_code_key" ON "fixed_asset_locations"("tenant_id", "organization_id", "code");

-- CreateIndex
CREATE INDEX "fixed_asset_acquisition_candidates_tenant_id_organization_i_idx" ON "fixed_asset_acquisition_candidates"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "fixed_asset_acquisition_candidates_tenant_id_source_documen_idx" ON "fixed_asset_acquisition_candidates"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "fixed_asset_acquisition_candidates_assigned_cip_project_id_idx" ON "fixed_asset_acquisition_candidates"("assigned_cip_project_id");

-- CreateIndex
CREATE INDEX "fixed_asset_acquisition_candidates_assigned_asset_id_idx" ON "fixed_asset_acquisition_candidates"("assigned_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_acquisition_candidates_tenant_id_source_key_key" ON "fixed_asset_acquisition_candidates"("tenant_id", "source_key");

-- CreateIndex
CREATE INDEX "capital_investment_projects_tenant_id_organization_id_statu_idx" ON "capital_investment_projects"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capital_investment_projects_tenant_id_organization_id_code_key" ON "capital_investment_projects"("tenant_id", "organization_id", "code");

-- CreateIndex
CREATE INDEX "capital_investment_costs_tenant_id_organization_id_cip_proj_idx" ON "capital_investment_costs"("tenant_id", "organization_id", "cip_project_id");

-- CreateIndex
CREATE INDEX "capital_investment_costs_tenant_id_source_document_type_sou_idx" ON "capital_investment_costs"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "capital_investment_costs_cip_project_id_cost_component_idx" ON "capital_investment_costs"("cip_project_id", "cost_component");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_organization_id_status_idx" ON "fixed_assets"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_category_id_idx" ON "fixed_assets"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_department_id_idx" ON "fixed_assets"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_location_id_idx" ON "fixed_assets"("tenant_id", "location_id");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_responsible_person_id_idx" ON "fixed_assets"("tenant_id", "responsible_person_id");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_commissioning_date_idx" ON "fixed_assets"("tenant_id", "commissioning_date");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_depreciation_start_date_idx" ON "fixed_assets"("tenant_id", "depreciation_start_date");

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_barcode_idx" ON "fixed_assets"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "fixed_assets_parent_asset_id_idx" ON "fixed_assets"("parent_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_tenant_id_asset_number_key" ON "fixed_assets"("tenant_id", "asset_number");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_tenant_id_organization_id_inventory_number_key" ON "fixed_assets"("tenant_id", "organization_id", "inventory_number");

-- CreateIndex
CREATE INDEX "fixed_asset_cost_components_tenant_id_asset_id_idx" ON "fixed_asset_cost_components"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "fixed_asset_cost_components_candidate_id_idx" ON "fixed_asset_cost_components"("candidate_id");

-- CreateIndex
CREATE INDEX "fixed_asset_cost_components_cip_project_id_idx" ON "fixed_asset_cost_components"("cip_project_id");

-- CreateIndex
CREATE INDEX "fixed_asset_book_policies_tenant_id_asset_id_book_code_effe_idx" ON "fixed_asset_book_policies"("tenant_id", "asset_id", "book_code", "effective_period");

-- CreateIndex
CREATE INDEX "fixed_asset_assignments_tenant_id_asset_id_valid_from_idx" ON "fixed_asset_assignments"("tenant_id", "asset_id", "valid_from");

-- CreateIndex
CREATE INDEX "fixed_asset_assignments_tenant_id_department_id_idx" ON "fixed_asset_assignments"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "fixed_asset_assignments_tenant_id_responsible_person_id_idx" ON "fixed_asset_assignments"("tenant_id", "responsible_person_id");

-- CreateIndex
CREATE INDEX "fixed_asset_parameter_history_tenant_id_asset_id_parameter__idx" ON "fixed_asset_parameter_history"("tenant_id", "asset_id", "parameter_code");

-- CreateIndex
CREATE INDEX "fixed_asset_movements_tenant_id_organization_id_business_da_idx" ON "fixed_asset_movements"("tenant_id", "organization_id", "business_date");

-- CreateIndex
CREATE INDEX "fixed_asset_movements_tenant_id_asset_id_book_code_sequence_idx" ON "fixed_asset_movements"("tenant_id", "asset_id", "book_code", "sequence");

-- CreateIndex
CREATE INDEX "fixed_asset_movements_tenant_id_asset_id_movement_type_peri_idx" ON "fixed_asset_movements"("tenant_id", "asset_id", "movement_type", "period");

-- CreateIndex
CREATE INDEX "fixed_asset_movements_tenant_id_source_document_type_source_idx" ON "fixed_asset_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "fixed_asset_movements_reversal_of_movement_id_idx" ON "fixed_asset_movements"("reversal_of_movement_id");

-- CreateIndex
CREATE INDEX "fixed_asset_documents_tenant_id_organization_id_document_ty_idx" ON "fixed_asset_documents"("tenant_id", "organization_id", "document_type", "document_date");

-- CreateIndex
CREATE INDEX "fixed_asset_documents_tenant_id_source_document_type_source_idx" ON "fixed_asset_documents"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_documents_tenant_id_number_key" ON "fixed_asset_documents"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "fixed_asset_document_lines_tenant_id_asset_id_idx" ON "fixed_asset_document_lines"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "fixed_asset_document_lines_document_id_idx" ON "fixed_asset_document_lines"("document_id");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciation_runs_tenant_id_organization_id_per_idx" ON "fixed_asset_depreciation_runs"("tenant_id", "organization_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciation_runs_tenant_id_organization_id_boo_key" ON "fixed_asset_depreciation_runs"("tenant_id", "organization_id", "book_code", "period", "run_version");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciation_lines_posted_key_key" ON "fixed_asset_depreciation_lines"("posted_key");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciation_lines_tenant_id_asset_id_period_idx" ON "fixed_asset_depreciation_lines"("tenant_id", "asset_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciation_lines_run_id_asset_id_key" ON "fixed_asset_depreciation_lines"("run_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciation_periods_tenant_id_organization_id__key" ON "fixed_asset_depreciation_periods"("tenant_id", "organization_id", "book_code", "period");

-- CreateIndex
CREATE INDEX "fixed_asset_inventory_counts_tenant_id_organization_id_coun_idx" ON "fixed_asset_inventory_counts"("tenant_id", "organization_id", "count_date");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_inventory_counts_tenant_id_number_key" ON "fixed_asset_inventory_counts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "fixed_asset_inventory_results_count_id_result_idx" ON "fixed_asset_inventory_results"("count_id", "result");

-- CreateIndex
CREATE INDEX "fixed_asset_inventory_results_tenant_id_asset_id_idx" ON "fixed_asset_inventory_results"("tenant_id", "asset_id");

-- AddForeignKey
ALTER TABLE "capital_investment_costs" ADD CONSTRAINT "capital_investment_costs_cip_project_id_fkey" FOREIGN KEY ("cip_project_id") REFERENCES "capital_investment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fixed_asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_cost_components" ADD CONSTRAINT "fixed_asset_cost_components_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_book_policies" ADD CONSTRAINT "fixed_asset_book_policies_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_assignments" ADD CONSTRAINT "fixed_asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_movements" ADD CONSTRAINT "fixed_asset_movements_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_document_lines" ADD CONSTRAINT "fixed_asset_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "fixed_asset_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_lines" ADD CONSTRAINT "fixed_asset_depreciation_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "fixed_asset_depreciation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_inventory_results" ADD CONSTRAINT "fixed_asset_inventory_results_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "fixed_asset_inventory_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

