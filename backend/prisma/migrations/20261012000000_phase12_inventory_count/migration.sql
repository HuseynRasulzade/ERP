-- CreateTable
CREATE TABLE "inventory_count_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "document_number" TEXT NOT NULL,
    "plan_date" DATE NOT NULL,
    "planned_start_at" TIMESTAMP(3),
    "planned_end_at" TIMESTAMP(3),
    "count_type" TEXT NOT NULL,
    "reason" TEXT,
    "responsible_user_id" TEXT,
    "count_manager_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "blind_count_enabled" BOOLEAN NOT NULL DEFAULT true,
    "full_blind_count" BOOLEAN NOT NULL DEFAULT false,
    "blind_recount" BOOLEAN NOT NULL DEFAULT true,
    "freeze_policy" TEXT NOT NULL DEFAULT 'NO_FREEZE_WITH_MOVEMENT_TRACKING',
    "cutoff_mode" TEXT NOT NULL DEFAULT 'GLOBAL_SNAPSHOT_CUTOFF',
    "duplicate_entry_policy" TEXT NOT NULL DEFAULT 'AGGREGATE',
    "repeated_scan_mode" TEXT NOT NULL DEFAULT 'INCREMENT',
    "uncounted_policy" TEXT NOT NULL DEFAULT 'MARK_UNCOUNTED',
    "require_full_coverage" BOOLEAN NOT NULL DEFAULT false,
    "recount_policy" TEXT NOT NULL DEFAULT 'NO_RECOUNT',
    "recount_quantity_threshold" DECIMAL(18,6),
    "recount_value_threshold" DECIMAL(18,2),
    "recount_percent_threshold" DECIMAL(9,4),
    "max_recount_attempts" INTEGER NOT NULL DEFAULT 2,
    "final_quantity_rule" TEXT NOT NULL DEFAULT 'LATEST_RECOUNT',
    "require_independent_recount" BOOLEAN NOT NULL DEFAULT false,
    "tolerance_quantity" DECIMAL(18,6),
    "tolerance_percent" DECIMAL(9,4),
    "tolerance_value" DECIMAL(18,2),
    "auto_accept_within_tolerance" BOOLEAN NOT NULL DEFAULT false,
    "surplus_cost_policy" TEXT NOT NULL DEFAULT 'CURRENT_WEIGHTED_AVERAGE',
    "shortage_cost_policy" TEXT NOT NULL DEFAULT 'CURRENT_COST',
    "costing_strictness" TEXT NOT NULL DEFAULT 'STRICT',
    "location_mismatch_policy" TEXT NOT NULL DEFAULT 'LOCATION_TRANSFER',
    "adjustment_date_policy" TEXT NOT NULL DEFAULT 'SNAPSHOT_DATE',
    "stale_policy" TEXT NOT NULL DEFAULT 'BLOCK',
    "approval_required" BOOLEAN NOT NULL DEFAULT true,
    "approval_thresholds" JSONB,
    "critical_shortage_value" DECIMAL(18,2),
    "forbid_counter_approval" BOOLEAN NOT NULL DEFAULT true,
    "forbid_warehouse_keeper_self_approval" BOOLEAN NOT NULL DEFAULT true,
    "variance_approval_policy_id" TEXT,
    "financial_year" INTEGER,
    "year_end_count" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_close_dependency" BOOLEAN NOT NULL DEFAULT false,
    "current_session_id" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_count_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_scopes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL DEFAULT 'INCLUDE',
    "dimension" TEXT NOT NULL,
    "value_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "inventory_count_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_teams" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "inventory_count_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "inventory_count_plan_id" TEXT NOT NULL,
    "session_number" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'INVENTORY_COUNT_SESSION',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "approval_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "reconciliation_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "freeze_policy" TEXT NOT NULL,
    "freeze_active" BOOLEAN NOT NULL DEFAULT false,
    "blind_count" BOOLEAN NOT NULL,
    "accounting_quantity_visibility" TEXT NOT NULL DEFAULT 'HIDDEN',
    "snapshot_version" INTEGER NOT NULL DEFAULT 0,
    "scope_revision" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_by" TEXT,
    "snapshot_at" TIMESTAMP(3),
    "count_cutoff_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "variance_calculated_at" TIMESTAMP(3),
    "calculation_version" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "adjustment_date" DATE,
    "posted_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "snapshot_version" INTEGER NOT NULL,
    "line_key" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "product_id" TEXT NOT NULL,
    "characteristic_id" TEXT,
    "batch_id" TEXT,
    "serial_id" TEXT,
    "ownership_type" TEXT NOT NULL,
    "owner_counterparty_id" TEXT,
    "stock_status" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "accounting_quantity" DECIMAL(18,6) NOT NULL,
    "base_quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6),
    "stock_value" DECIMAL(18,2),
    "costing_status" TEXT,
    "snapshot_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_freeze_locks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "product_id" TEXT,
    "policy" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_by" TEXT,
    "released_at" TIMESTAMP(3),
    "released_by" TEXT,

    CONSTRAINT "inventory_count_freeze_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_sheets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sheet_number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "location_scope" TEXT,
    "assigned_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "blind_count" BOOLEAN NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "barcode_mode" TEXT NOT NULL DEFAULT 'INCREMENT',
    "comment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_count_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "location_id" TEXT,
    "assigned_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "progress" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "start_at" TIMESTAMP(3),
    "finish_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "task_id" TEXT,
    "line_key" TEXT,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "product_id" TEXT,
    "characteristic_id" TEXT,
    "batch_id" TEXT,
    "serial_id" TEXT,
    "serial_number_text" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "owner_counterparty_id" TEXT,
    "stock_status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "unit_id" TEXT,
    "counted_quantity" DECIMAL(18,6) NOT NULL,
    "conversion_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "base_quantity" DECIMAL(18,6) NOT NULL,
    "is_explicit_zero" BOOLEAN NOT NULL DEFAULT false,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_by" TEXT,
    "entry_method" TEXT NOT NULL DEFAULT 'MANUAL',
    "barcode" TEXT,
    "notes" TEXT,
    "evidence_attachment_id" TEXT,
    "entry_version" INTEGER NOT NULL DEFAULT 1,
    "client_entry_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "unknown_item_description" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_entry_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "entry_version" INTEGER NOT NULL,
    "change_type" TEXT NOT NULL,
    "old_quantity" DECIMAL(18,6),
    "new_quantity" DECIMAL(18,6),
    "old_base_quantity" DECIMAL(18,6),
    "new_base_quantity" DECIMAL(18,6),
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "inventory_count_entry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_variances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "line_key" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "product_id" TEXT,
    "characteristic_id" TEXT,
    "batch_id" TEXT,
    "serial_id" TEXT,
    "serial_number_text" TEXT,
    "ownership_type" TEXT NOT NULL,
    "owner_counterparty_id" TEXT,
    "quality_status" TEXT NOT NULL,
    "unit_id" TEXT,
    "accounting_quantity" DECIMAL(18,6) NOT NULL,
    "post_snapshot_in_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "post_snapshot_out_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "adjusted_accounting_quantity" DECIMAL(18,6) NOT NULL,
    "counted_quantity" DECIMAL(18,6),
    "physical_quantity" DECIMAL(18,6),
    "quantity_difference" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "count_status" TEXT NOT NULL,
    "variance_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'NONE',
    "matched_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "cutoff_at" TIMESTAMP(3),
    "unit_cost" DECIMAL(18,6),
    "cost_source" TEXT,
    "costing_status" TEXT,
    "value_difference" DECIMAL(18,2),
    "severity" TEXT NOT NULL DEFAULT 'NONE',
    "within_tolerance" BOOLEAN NOT NULL DEFAULT false,
    "resolution_status" TEXT NOT NULL DEFAULT 'OPEN',
    "suggested_resolution" TEXT,
    "recount_status" TEXT NOT NULL DEFAULT 'NONE',
    "recount_attempts" INTEGER NOT NULL DEFAULT 0,
    "reason_code" TEXT,
    "investigation_notes" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "responsible_employee_id" TEXT,
    "recoverable_amount" DECIMAL(18,2),
    "recovery_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_variances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_variance_matches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "shortage_variance_id" TEXT NOT NULL,
    "surplus_variance_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "calculation_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_variance_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_variance_decisions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "variance_id" TEXT NOT NULL,
    "final_physical_qty" DECIMAL(18,6),
    "accepted_difference" DECIMAL(18,6),
    "resolution_type" TEXT NOT NULL,
    "reason_code" TEXT,
    "approved_cost" DECIMAL(18,6),
    "decided_by" TEXT,
    "approver" TEXT,
    "approved_at" TIMESTAMP(3),
    "is_automatic" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_variance_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_recounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "variance_id" TEXT NOT NULL,
    "recount_number" INTEGER NOT NULL,
    "assigned_user_id" TEXT,
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "counted_by" TEXT,
    "physical_quantity" DECIMAL(18,6),
    "reason" TEXT,
    "is_automatic" BOOLEAN NOT NULL DEFAULT false,
    "result_status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "inventory_recounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'INVENTORY_COUNT_ADJUSTMENT',
    "operation_type" TEXT NOT NULL,
    "posting_key" TEXT NOT NULL,
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "total_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_value" DECIMAL(18,2),
    "description" TEXT,
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

    CONSTRAINT "inventory_count_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_adjustment_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "adjustment_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "variance_id" TEXT,
    "counter_variance_id" TEXT,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "batch_id" TEXT,
    "to_batch_id" TEXT,
    "serial_id" TEXT,
    "to_serial_id" TEXT,
    "location_id" TEXT,
    "to_location_id" TEXT,
    "stock_status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "to_stock_status" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "owner_counterparty_id" TEXT,
    "expected_adjusted_qty" DECIMAL(18,6),
    "unit_cost" DECIMAL(18,6),
    "amount" DECIMAL(18,2),
    "cost_source" TEXT,
    "costing_status" TEXT,
    "approved_cost" DECIMAL(18,6),
    "reason_code" TEXT,
    "responsible_employee_id" TEXT,
    "recoverable_amount" DECIMAL(18,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_reconciliations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "snapshot_total_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "post_snapshot_in_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "post_snapshot_out_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "adjusted_accounting_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "physical_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "surplus_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "shortage_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "location_mismatch_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_surplus_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_shortage_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_value_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_document_count" INTEGER NOT NULL DEFAULT 0,
    "posted_adjustment_count" INTEGER NOT NULL DEFAULT 0,
    "unresolved_variance_count" INTEGER NOT NULL DEFAULT 0,
    "expected_final_qty" DECIMAL(18,6),
    "actual_final_qty" DECIMAL(18,6),
    "quantity_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "value_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "gl_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "subledger_value_change" DECIMAL(18,2),
    "gl_inventory_change" DECIMAL(18,2),
    "details" JSONB,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_count_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_reason_codes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_reason_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "variance_id" TEXT,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT,
    "description" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT,
    "plan_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "inventory_count_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_count_plans_tenant_id_organization_id_status_idx" ON "inventory_count_plans"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "inventory_count_plans_tenant_id_organization_id_plan_date_idx" ON "inventory_count_plans"("tenant_id", "organization_id", "plan_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_plans_tenant_id_document_number_key" ON "inventory_count_plans"("tenant_id", "document_number");

-- CreateIndex
CREATE INDEX "inventory_count_scopes_tenant_id_plan_id_active_idx" ON "inventory_count_scopes"("tenant_id", "plan_id", "active");

-- CreateIndex
CREATE INDEX "inventory_count_teams_tenant_id_user_id_idx" ON "inventory_count_teams"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_teams_plan_id_user_id_role_key" ON "inventory_count_teams"("plan_id", "user_id", "role");

-- CreateIndex
CREATE INDEX "inventory_count_sessions_tenant_id_organization_id_status_idx" ON "inventory_count_sessions"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "inventory_count_sessions_tenant_id_inventory_count_plan_id_idx" ON "inventory_count_sessions"("tenant_id", "inventory_count_plan_id");

-- CreateIndex
CREATE INDEX "inventory_count_sessions_tenant_id_snapshot_at_idx" ON "inventory_count_sessions"("tenant_id", "snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_sessions_tenant_id_session_number_key" ON "inventory_count_sessions"("tenant_id", "session_number");

-- CreateIndex
CREATE INDEX "inventory_count_snapshots_tenant_id_session_id_warehouse_id_idx" ON "inventory_count_snapshots"("tenant_id", "session_id", "warehouse_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_count_snapshots_tenant_id_product_id_idx" ON "inventory_count_snapshots"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_count_snapshots_tenant_id_batch_id_idx" ON "inventory_count_snapshots"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "inventory_count_snapshots_tenant_id_serial_id_idx" ON "inventory_count_snapshots"("tenant_id", "serial_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_snapshots_session_id_snapshot_version_line__key" ON "inventory_count_snapshots"("session_id", "snapshot_version", "line_key");

-- CreateIndex
CREATE INDEX "inventory_count_freeze_locks_tenant_id_warehouse_id_active_idx" ON "inventory_count_freeze_locks"("tenant_id", "warehouse_id", "active");

-- CreateIndex
CREATE INDEX "inventory_count_freeze_locks_tenant_id_session_id_idx" ON "inventory_count_freeze_locks"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "inventory_count_sheets_tenant_id_session_id_status_idx" ON "inventory_count_sheets"("tenant_id", "session_id", "status");

-- CreateIndex
CREATE INDEX "inventory_count_sheets_tenant_id_assigned_user_id_idx" ON "inventory_count_sheets"("tenant_id", "assigned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_sheets_session_id_sheet_number_key" ON "inventory_count_sheets"("session_id", "sheet_number");

-- CreateIndex
CREATE INDEX "inventory_count_tasks_tenant_id_sheet_id_idx" ON "inventory_count_tasks"("tenant_id", "sheet_id");

-- CreateIndex
CREATE INDEX "inventory_count_tasks_tenant_id_assigned_user_id_idx" ON "inventory_count_tasks"("tenant_id", "assigned_user_id");

-- CreateIndex
CREATE INDEX "inventory_count_entries_tenant_id_session_id_line_key_idx" ON "inventory_count_entries"("tenant_id", "session_id", "line_key");

-- CreateIndex
CREATE INDEX "inventory_count_entries_tenant_id_session_id_serial_id_idx" ON "inventory_count_entries"("tenant_id", "session_id", "serial_id");

-- CreateIndex
CREATE INDEX "inventory_count_entries_tenant_id_product_id_idx" ON "inventory_count_entries"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_count_entries_tenant_id_session_id_counted_at_idx" ON "inventory_count_entries"("tenant_id", "session_id", "counted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_entries_session_id_client_entry_id_key" ON "inventory_count_entries"("session_id", "client_entry_id");

-- CreateIndex
CREATE INDEX "inventory_count_entry_versions_tenant_id_entry_id_idx" ON "inventory_count_entry_versions"("tenant_id", "entry_id");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_session_id_variance_type_idx" ON "inventory_variances"("tenant_id", "session_id", "variance_type");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_session_id_resolution_status_idx" ON "inventory_variances"("tenant_id", "session_id", "resolution_status");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_product_id_idx" ON "inventory_variances"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_warehouse_id_location_id_idx" ON "inventory_variances"("tenant_id", "warehouse_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_batch_id_idx" ON "inventory_variances"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_serial_id_idx" ON "inventory_variances"("tenant_id", "serial_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_variances_session_id_line_key_key" ON "inventory_variances"("session_id", "line_key");

-- CreateIndex
CREATE INDEX "inventory_variance_matches_tenant_id_session_id_idx" ON "inventory_variance_matches"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "inventory_variance_decisions_tenant_id_variance_id_idx" ON "inventory_variance_decisions"("tenant_id", "variance_id");

-- CreateIndex
CREATE INDEX "inventory_recounts_tenant_id_session_id_result_status_idx" ON "inventory_recounts"("tenant_id", "session_id", "result_status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_recounts_variance_id_recount_number_key" ON "inventory_recounts"("variance_id", "recount_number");

-- CreateIndex
CREATE INDEX "inventory_count_adjustments_tenant_id_session_id_idx" ON "inventory_count_adjustments"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_adjustments_tenant_id_posting_key_key" ON "inventory_count_adjustments"("tenant_id", "posting_key");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_adjustments_tenant_id_number_key" ON "inventory_count_adjustments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "inventory_count_adjustment_lines_adjustment_id_position_idx" ON "inventory_count_adjustment_lines"("adjustment_id", "position");

-- CreateIndex
CREATE INDEX "inventory_count_adjustment_lines_tenant_id_variance_id_idx" ON "inventory_count_adjustment_lines"("tenant_id", "variance_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_reconciliations_session_id_key" ON "inventory_count_reconciliations"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_reason_codes_tenant_id_code_key" ON "inventory_count_reason_codes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "inventory_count_attachments_tenant_id_session_id_idx" ON "inventory_count_attachments"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "inventory_count_events_tenant_id_published_at_idx" ON "inventory_count_events"("tenant_id", "published_at");

-- CreateIndex
CREATE INDEX "inventory_count_events_tenant_id_session_id_idx" ON "inventory_count_events"("tenant_id", "session_id");

-- AddForeignKey
ALTER TABLE "inventory_count_scopes" ADD CONSTRAINT "inventory_count_scopes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "inventory_count_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_teams" ADD CONSTRAINT "inventory_count_teams_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "inventory_count_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_inventory_count_plan_id_fkey" FOREIGN KEY ("inventory_count_plan_id") REFERENCES "inventory_count_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_snapshots" ADD CONSTRAINT "inventory_count_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_freeze_locks" ADD CONSTRAINT "inventory_count_freeze_locks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sheets" ADD CONSTRAINT "inventory_count_sheets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_tasks" ADD CONSTRAINT "inventory_count_tasks_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "inventory_count_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "inventory_count_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "inventory_count_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entry_versions" ADD CONSTRAINT "inventory_count_entry_versions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "inventory_count_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_variances" ADD CONSTRAINT "inventory_variances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_variance_decisions" ADD CONSTRAINT "inventory_variance_decisions_variance_id_fkey" FOREIGN KEY ("variance_id") REFERENCES "inventory_variances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_recounts" ADD CONSTRAINT "inventory_recounts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_recounts" ADD CONSTRAINT "inventory_recounts_variance_id_fkey" FOREIGN KEY ("variance_id") REFERENCES "inventory_variances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_adjustments" ADD CONSTRAINT "inventory_count_adjustments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_adjustment_lines" ADD CONSTRAINT "inventory_count_adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "inventory_count_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_reconciliations" ADD CONSTRAINT "inventory_count_reconciliations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_attachments" ADD CONSTRAINT "inventory_count_attachments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

