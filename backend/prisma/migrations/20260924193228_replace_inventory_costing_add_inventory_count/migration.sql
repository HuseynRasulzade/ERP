/*
  Warnings:

  - You are about to alter the column `consumed_cost` on the `inventory_cost_consumptions` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,6)` to `Decimal(18,2)`.
  - You are about to alter the column `original_total_cost` on the `inventory_cost_layers` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,6)` to `Decimal(18,2)`.
  - You are about to alter the column `current_remaining_value` on the `inventory_cost_layers` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,6)` to `Decimal(18,2)`.
  - You are about to drop the column `final_cost` on the `inventory_cost_movements` table. All the data in the column will be lost.
  - You are about to drop the column `posting_date` on the `inventory_cost_movements` table. All the data in the column will be lost.
  - You are about to drop the column `posting_version` on the `inventory_cost_movements` table. All the data in the column will be lost.
  - You are about to drop the column `valuation_currency_id` on the `inventory_cost_movements` table. All the data in the column will be lost.
  - You are about to alter the column `total_cost` on the `inventory_cost_movements` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,6)` to `Decimal(18,2)`.
  - The `provisional_cost` column on the `inventory_cost_movements` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `active` on the `inventory_costing_policies` table. All the data in the column will be lost.
  - You are about to drop the column `rounding_policy` on the `inventory_costing_policies` table. All the data in the column will be lost.
  - You are about to drop the `inventory_cost_balances` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `average_method` on table `inventory_costing_policies` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "cash_transactions" DROP CONSTRAINT "cash_transactions_counterparty_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_transactions" DROP CONSTRAINT "cash_transactions_currency_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_purchase_invoice_id_fkey";

-- DropIndex
DROP INDEX "inventory_cost_consumptions_outgoing_inventory_movement_id_idx";

-- DropIndex
DROP INDEX "inventory_cost_consumptions_tenant_id_cost_layer_id_idx";

-- DropIndex
DROP INDEX "inventory_cost_layers_source_inventory_movement_id_idx";

-- DropIndex
DROP INDEX "inventory_cost_movements_source_inventory_movement_id_key";

-- DropIndex
DROP INDEX "inventory_cost_movements_tenant_id_costing_key_idx";

-- DropIndex
DROP INDEX "inventory_cost_movements_tenant_id_product_id_idx";

-- AlterTable
ALTER TABLE "bank_statement_lines" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inventory_cost_consumptions" ADD COLUMN     "reversed" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "outgoing_inventory_movement_id" DROP NOT NULL,
ALTER COLUMN "consumed_cost" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "inventory_cost_layers" ALTER COLUMN "source_receipt_document_type" DROP NOT NULL,
ALTER COLUMN "source_receipt_document_id" DROP NOT NULL,
ALTER COLUMN "source_receipt_line_id" DROP NOT NULL,
ALTER COLUMN "source_inventory_movement_id" DROP NOT NULL,
ALTER COLUMN "receipt_date" SET DATA TYPE DATE,
ALTER COLUMN "original_total_cost" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "current_remaining_value" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "currency_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "inventory_cost_movements" DROP COLUMN "final_cost",
DROP COLUMN "posting_date",
DROP COLUMN "posting_version",
DROP COLUMN "valuation_currency_id",
ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "currency_id" TEXT,
ADD COLUMN     "posting_sequence" BIGSERIAL NOT NULL,
ALTER COLUMN "source_inventory_movement_id" DROP NOT NULL,
ALTER COLUMN "effective_date" SET DATA TYPE DATE,
ALTER COLUMN "unit_cost" DROP NOT NULL,
ALTER COLUMN "total_cost" SET DATA TYPE DECIMAL(18,2),
DROP COLUMN "provisional_cost",
ADD COLUMN     "provisional_cost" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "cost_status" SET DEFAULT 'UNCALCULATED';

-- AlterTable
ALTER TABLE "inventory_costing_policies" DROP COLUMN "active",
DROP COLUMN "rounding_policy",
ADD COLUMN     "consignment_included_in_valuation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "negative_stock_cost_policy" TEXT NOT NULL DEFAULT 'LAST_KNOWN_COST',
ADD COLUMN     "rounding_precision" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "costing_method" SET DEFAULT 'WEIGHTED_AVERAGE',
ALTER COLUMN "average_method" SET NOT NULL,
ALTER COLUMN "average_method" SET DEFAULT 'MOVING_AVERAGE',
ALTER COLUMN "valuation_currency_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- DropTable
DROP TABLE "inventory_cost_balances";

-- CreateTable
CREATE TABLE "inventory_cost_components" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cost_layer_id" TEXT NOT NULL,
    "component_type" TEXT NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'INVENTORY_COST_ADJUSTMENT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "reason" TEXT NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "calculation_run_id" TEXT,
    "comment" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_cost_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_adjustment_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "inventory_cost_adjustment_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "costing_key" TEXT NOT NULL,
    "cost_layer_id" TEXT,
    "quantity_reference" DECIMAL(18,6),
    "old_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_amount" DECIMAL(18,2) NOT NULL,
    "new_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "on_hand_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cogs_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_calculation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period" TEXT,
    "calculation_type" TEXT NOT NULL,
    "method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "initiated_by" TEXT,
    "source_trigger" TEXT,
    "earliest_affected_date" DATE,
    "movement_count" INTEGER NOT NULL DEFAULT 0,
    "adjustment_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "inventory_cost_calculation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_costing_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "provisional_calculated_at" TIMESTAMP(3),
    "final_calculated_at" TIMESTAMP(3),
    "finalized_by" TEXT,
    "calculation_run_id" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopened_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_costing_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_costing_errors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "calculation_run_id" TEXT,
    "product_id" TEXT,
    "costing_key" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "error_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ERROR',
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_costing_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_recalculation_queue" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "earliest_affected_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "calculation_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_recalculation_queue_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "inventory_cost_components_tenant_id_cost_layer_id_idx" ON "inventory_cost_components"("tenant_id", "cost_layer_id");

-- CreateIndex
CREATE INDEX "inventory_cost_adjustments_tenant_id_organization_id_idx" ON "inventory_cost_adjustments"("tenant_id", "organization_id");

-- CreateIndex
CREATE INDEX "inventory_cost_adjustment_lines_inventory_cost_adjustment_i_idx" ON "inventory_cost_adjustment_lines"("inventory_cost_adjustment_id");

-- CreateIndex
CREATE INDEX "inventory_cost_calculation_runs_tenant_id_organization_id_s_idx" ON "inventory_cost_calculation_runs"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_costing_periods_tenant_id_organization_id_year_mo_key" ON "inventory_costing_periods"("tenant_id", "organization_id", "year", "month");

-- CreateIndex
CREATE INDEX "inventory_costing_errors_tenant_id_organization_id_resolved_idx" ON "inventory_costing_errors"("tenant_id", "organization_id", "resolved");

-- CreateIndex
CREATE INDEX "inventory_costing_errors_tenant_id_calculation_run_id_idx" ON "inventory_costing_errors"("tenant_id", "calculation_run_id");

-- CreateIndex
CREATE INDEX "inventory_cost_recalculation_queue_tenant_id_status_earlies_idx" ON "inventory_cost_recalculation_queue"("tenant_id", "status", "earliest_affected_date");

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

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_document_typ_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_document_type", "outgoing_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_document_lin_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_document_line_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_inventory_mo_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_inventory_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_layers_tenant_id_source_receipt_document_typ_idx" ON "inventory_cost_layers"("tenant_id", "source_receipt_document_type", "source_receipt_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_costing_key_effective_da_idx" ON "inventory_cost_movements"("tenant_id", "costing_key", "effective_date", "posting_sequence");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_source_document_type_sou_idx" ON "inventory_cost_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_source_inventory_movemen_idx" ON "inventory_cost_movements"("tenant_id", "source_inventory_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_calculation_run_id_idx" ON "inventory_cost_movements"("tenant_id", "calculation_run_id");

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_costing_policies" ADD CONSTRAINT "inventory_costing_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_costing_policies" ADD CONSTRAINT "inventory_costing_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_movements" ADD CONSTRAINT "inventory_cost_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_movements" ADD CONSTRAINT "inventory_cost_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_consumptions" ADD CONSTRAINT "inventory_cost_consumptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_components" ADD CONSTRAINT "inventory_cost_components_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_components" ADD CONSTRAINT "inventory_cost_components_cost_layer_id_fkey" FOREIGN KEY ("cost_layer_id") REFERENCES "inventory_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_adjustment_lines" ADD CONSTRAINT "inventory_cost_adjustment_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_adjustment_lines" ADD CONSTRAINT "inventory_cost_adjustment_lines_inventory_cost_adjustment__fkey" FOREIGN KEY ("inventory_cost_adjustment_id") REFERENCES "inventory_cost_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_calculation_runs" ADD CONSTRAINT "inventory_cost_calculation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_calculation_runs" ADD CONSTRAINT "inventory_cost_calculation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_costing_periods" ADD CONSTRAINT "inventory_costing_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_costing_periods" ADD CONSTRAINT "inventory_costing_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_costing_errors" ADD CONSTRAINT "inventory_costing_errors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_costing_errors" ADD CONSTRAINT "inventory_costing_errors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_recalculation_queue" ADD CONSTRAINT "inventory_cost_recalculation_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_recalculation_queue" ADD CONSTRAINT "inventory_cost_recalculation_queue_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- RenameIndex
ALTER INDEX "counterparty_contract_lines_tenant_id_source_sales_order_line_i" RENAME TO "counterparty_contract_lines_tenant_id_source_sales_order_li_idx";

-- RenameIndex
ALTER INDEX "inventory_cost_layers_tenant_id_costing_key_status_receipt_idx" RENAME TO "inventory_cost_layers_tenant_id_costing_key_status_receipt__idx";

-- RenameIndex
ALTER INDEX "inventory_costing_policies_tenant_id_organization_id_effec_idx" RENAME TO "inventory_costing_policies_tenant_id_organization_id_effect_idx";
