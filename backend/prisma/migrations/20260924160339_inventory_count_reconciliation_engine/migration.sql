-- AlterTable
ALTER TABLE "inventory_cost_consumptions" ALTER COLUMN "outgoing_inventory_movement_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "inventory_count_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "number" TEXT,
    "plan_date" DATE NOT NULL,
    "planned_start_at" TIMESTAMP(3),
    "planned_end_at" TIMESTAMP(3),
    "count_type" TEXT NOT NULL DEFAULT 'FULL',
    "reason" TEXT,
    "responsible_user_id" TEXT,
    "count_manager_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "blind_count_enabled" BOOLEAN NOT NULL DEFAULT true,
    "freeze_policy" TEXT NOT NULL DEFAULT 'NO_FREEZE_WITH_MOVEMENT_TRACKING',
    "cutoff_mode" TEXT NOT NULL DEFAULT 'GLOBAL_SNAPSHOT_CUTOFF',
    "recount_policy" TEXT NOT NULL DEFAULT 'RECOUNT_ABOVE_VALUE_THRESHOLD',
    "recount_quantity_threshold" DECIMAL(18,6),
    "recount_value_threshold" DECIMAL(18,2),
    "recount_percentage_threshold" DECIMAL(9,4),
    "max_recount_attempts" INTEGER NOT NULL DEFAULT 2,
    "variance_quantity_tolerance" DECIMAL(18,6),
    "variance_value_tolerance" DECIMAL(18,2),
    "variance_percentage_tolerance" DECIMAL(9,4),
    "surplus_cost_policy" TEXT NOT NULL DEFAULT 'CURRENT_AVERAGE',
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
    "inventory_count_plan_id" TEXT NOT NULL,
    "include_exclude" TEXT NOT NULL DEFAULT 'INCLUDE',
    "warehouse_id" TEXT,
    "location_id" TEXT,
    "location_subtree" BOOLEAN NOT NULL DEFAULT false,
    "product_id" TEXT,
    "product_group_id" TEXT,
    "batch_id" TEXT,
    "serial_id" TEXT,
    "ownership_type" TEXT,
    "quality_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "inventory_count_plan_id" TEXT NOT NULL,
    "session_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "started_at" TIMESTAMP(3),
    "snapshot_at" TIMESTAMP(3),
    "count_cutoff_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "started_by" TEXT,
    "completed_by" TEXT,
    "freeze_policy" TEXT NOT NULL,
    "blind_count" BOOLEAN NOT NULL,
    "cutoff_mode" TEXT NOT NULL DEFAULT 'GLOBAL_SNAPSHOT_CUTOFF',
    "snapshot_version" INTEGER NOT NULL DEFAULT 0,
    "reconciliation_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_snapshot_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "serial_id" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "quality_status" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "accounting_quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6),
    "inventory_value" DECIMAL(18,2),
    "costing_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_snapshot_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_sheets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sheet_number" TEXT,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "assigned_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "blind_count" BOOLEAN NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,

    CONSTRAINT "inventory_count_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "quality_status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "unit_id" TEXT NOT NULL,
    "counted_quantity" DECIMAL(18,6) NOT NULL,
    "base_quantity" DECIMAL(18,6) NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_by" TEXT NOT NULL,
    "entry_method" TEXT NOT NULL DEFAULT 'MANUAL',
    "barcode" TEXT,
    "notes" TEXT,
    "client_entry_id" TEXT,
    "entry_version" INTEGER NOT NULL DEFAULT 1,
    "voided" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "inventory_count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_entry_serials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,

    CONSTRAINT "inventory_count_entry_serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_entry_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "old_quantity" DECIMAL(18,6) NOT NULL,
    "new_quantity" DECIMAL(18,6) NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "inventory_count_entry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_recounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "variance_id" TEXT,
    "original_entry_id" TEXT,
    "recount_number" INTEGER NOT NULL DEFAULT 1,
    "assigned_user_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "physical_quantity" DECIMAL(18,6),
    "reason" TEXT,
    "result_status" TEXT NOT NULL DEFAULT 'PENDING',
    "counted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_recounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_variances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "location_id" TEXT,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "serial_id" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "quality_status" TEXT NOT NULL,
    "accounting_quantity" DECIMAL(18,6) NOT NULL,
    "adjusted_accounting_quantity" DECIMAL(18,6) NOT NULL,
    "physical_quantity" DECIMAL(18,6),
    "quantity_difference" DECIMAL(18,6) NOT NULL,
    "variance_type" TEXT NOT NULL,
    "unit_cost" DECIMAL(18,6),
    "value_difference" DECIMAL(18,2),
    "severity" TEXT NOT NULL DEFAULT 'NORMAL',
    "resolution_status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason_code" TEXT,
    "recount_required" BOOLEAN NOT NULL DEFAULT false,
    "recount_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_variances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_variance_decisions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "variance_id" TEXT NOT NULL,
    "final_physical_quantity" DECIMAL(18,6) NOT NULL,
    "accepted_difference" DECIMAL(18,6) NOT NULL,
    "resolution_type" TEXT NOT NULL,
    "reason_code" TEXT,
    "approved_cost" DECIMAL(18,6),
    "approver" TEXT,
    "approved_at" TIMESTAMP(3),
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_variance_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_adjustment_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "variance_id" TEXT,
    "adjustment_document_type" TEXT NOT NULL,
    "adjustment_document_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_adjustment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_reconciliations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "snapshot_total_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "adjusted_accounting_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "physical_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "surplus_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "shortage_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "location_mismatch_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_surplus_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_shortage_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_value_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_document_count" INTEGER NOT NULL DEFAULT 0,
    "unresolved_variance_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_count_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_count_plans_tenant_id_organization_id_status_idx" ON "inventory_count_plans"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "inventory_count_scopes_inventory_count_plan_id_idx" ON "inventory_count_scopes"("inventory_count_plan_id");

-- CreateIndex
CREATE INDEX "inventory_count_sessions_tenant_id_organization_id_status_idx" ON "inventory_count_sessions"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "inventory_count_snapshot_lines_session_id_idx" ON "inventory_count_snapshot_lines"("session_id");

-- CreateIndex
CREATE INDEX "inventory_count_snapshot_lines_tenant_id_session_id_warehou_idx" ON "inventory_count_snapshot_lines"("tenant_id", "session_id", "warehouse_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_count_sheets_session_id_idx" ON "inventory_count_sheets"("session_id");

-- CreateIndex
CREATE INDEX "inventory_count_entries_session_id_idx" ON "inventory_count_entries"("session_id");

-- CreateIndex
CREATE INDEX "inventory_count_entries_sheet_id_idx" ON "inventory_count_entries"("sheet_id");

-- CreateIndex
CREATE INDEX "inventory_count_entries_tenant_id_session_id_warehouse_id_p_idx" ON "inventory_count_entries"("tenant_id", "session_id", "warehouse_id", "product_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_entry_serials_entry_id_serial_number_key" ON "inventory_count_entry_serials"("entry_id", "serial_number");

-- CreateIndex
CREATE INDEX "inventory_count_entry_versions_entry_id_idx" ON "inventory_count_entry_versions"("entry_id");

-- CreateIndex
CREATE INDEX "inventory_recounts_session_id_idx" ON "inventory_recounts"("session_id");

-- CreateIndex
CREATE INDEX "inventory_recounts_tenant_id_variance_id_idx" ON "inventory_recounts"("tenant_id", "variance_id");

-- CreateIndex
CREATE INDEX "inventory_variances_session_id_idx" ON "inventory_variances"("session_id");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_session_id_variance_type_idx" ON "inventory_variances"("tenant_id", "session_id", "variance_type");

-- CreateIndex
CREATE INDEX "inventory_variances_tenant_id_session_id_resolution_status_idx" ON "inventory_variances"("tenant_id", "session_id", "resolution_status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_variance_decisions_variance_id_key" ON "inventory_variance_decisions"("variance_id");

-- CreateIndex
CREATE INDEX "inventory_count_adjustment_links_session_id_idx" ON "inventory_count_adjustment_links"("session_id");

-- CreateIndex
CREATE INDEX "inventory_count_adjustment_links_tenant_id_adjustment_docum_idx" ON "inventory_count_adjustment_links"("tenant_id", "adjustment_document_type", "adjustment_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_reconciliations_session_id_key" ON "inventory_count_reconciliations"("session_id");

-- AddForeignKey
ALTER TABLE "inventory_count_plans" ADD CONSTRAINT "inventory_count_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_plans" ADD CONSTRAINT "inventory_count_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_scopes" ADD CONSTRAINT "inventory_count_scopes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_scopes" ADD CONSTRAINT "inventory_count_scopes_inventory_count_plan_id_fkey" FOREIGN KEY ("inventory_count_plan_id") REFERENCES "inventory_count_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_inventory_count_plan_id_fkey" FOREIGN KEY ("inventory_count_plan_id") REFERENCES "inventory_count_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_snapshot_lines" ADD CONSTRAINT "inventory_count_snapshot_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_snapshot_lines" ADD CONSTRAINT "inventory_count_snapshot_lines_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sheets" ADD CONSTRAINT "inventory_count_sheets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_sheets" ADD CONSTRAINT "inventory_count_sheets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "inventory_count_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entry_serials" ADD CONSTRAINT "inventory_count_entry_serials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entry_serials" ADD CONSTRAINT "inventory_count_entry_serials_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "inventory_count_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entry_versions" ADD CONSTRAINT "inventory_count_entry_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_entry_versions" ADD CONSTRAINT "inventory_count_entry_versions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "inventory_count_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_recounts" ADD CONSTRAINT "inventory_recounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_recounts" ADD CONSTRAINT "inventory_recounts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_variances" ADD CONSTRAINT "inventory_variances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_variances" ADD CONSTRAINT "inventory_variances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_variance_decisions" ADD CONSTRAINT "inventory_variance_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_variance_decisions" ADD CONSTRAINT "inventory_variance_decisions_variance_id_fkey" FOREIGN KEY ("variance_id") REFERENCES "inventory_variances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_adjustment_links" ADD CONSTRAINT "inventory_count_adjustment_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_adjustment_links" ADD CONSTRAINT "inventory_count_adjustment_links_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_reconciliations" ADD CONSTRAINT "inventory_count_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_reconciliations" ADD CONSTRAINT "inventory_count_reconciliations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
