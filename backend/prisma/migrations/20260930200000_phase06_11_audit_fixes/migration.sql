-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "sequence_no" BIGSERIAL NOT NULL;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "inventory_costing_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "costing_method" TEXT NOT NULL DEFAULT 'FIFO',
    "average_method" TEXT NOT NULL DEFAULT 'MOVING_AVERAGE',
    "valuation_currency_id" TEXT,
    "include_purchase_additional_costs" BOOLEAN NOT NULL DEFAULT true,
    "include_customs_cost" BOOLEAN NOT NULL DEFAULT true,
    "include_freight" BOOLEAN NOT NULL DEFAULT true,
    "allow_provisional_cost" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_quantity_costing" BOOLEAN NOT NULL DEFAULT true,
    "recalculate_backdated_documents" BOOLEAN NOT NULL DEFAULT true,
    "cost_by_warehouse" BOOLEAN NOT NULL DEFAULT false,
    "cost_by_characteristic" BOOLEAN NOT NULL DEFAULT false,
    "cost_by_batch" BOOLEAN NOT NULL DEFAULT false,
    "financial_ownership_types" TEXT[] DEFAULT ARRAY['OWN']::TEXT[],
    "negative_stock_cost_policy" TEXT NOT NULL DEFAULT 'LAST_KNOWN_COST',
    "sales_return_without_source_cost" TEXT NOT NULL DEFAULT 'CURRENT_AVERAGE',
    "purchase_return_additional_cost_treatment" TEXT NOT NULL DEFAULT 'PROPORTIONAL_REVERSAL',
    "unpost_dependency_policy" TEXT NOT NULL DEFAULT 'BLOCK',
    "cogs_timing" TEXT NOT NULL DEFAULT 'IMMEDIATE_PROVISIONAL',
    "reconciliation_tolerance" DECIMAL(18,2) NOT NULL DEFAULT 0.01,
    "rounding_policy" TEXT NOT NULL DEFAULT 'LINE_LEVEL_LARGEST_REMAINDER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "inventory_costing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "physical_warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "source_inventory_movement_id" TEXT NOT NULL,
    "movement_sequence" BIGINT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "effective_date" DATE NOT NULL,
    "posting_date" DATE,
    "movement_type" TEXT NOT NULL,
    "movement_class" TEXT NOT NULL,
    "gl_treatment" TEXT NOT NULL,
    "counter_mapping_key" TEXT,
    "counter_account_id" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "provisional_cost" DECIMAL(18,2),
    "final_cost" DECIMAL(18,2),
    "deficit_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "provisional_unit_cost" DECIMAL(18,6),
    "gl_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "document_gl_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "valuation_currency_id" TEXT,
    "method" TEXT NOT NULL,
    "posting_version" INTEGER NOT NULL DEFAULT 1,
    "cost_status" TEXT NOT NULL DEFAULT 'UNCALCULATED',
    "calculation_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_cost_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_layers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "batch_id" TEXT,
    "source_cost_movement_id" TEXT NOT NULL,
    "source_inventory_movement_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "receipt_date" DATE NOT NULL,
    "movement_sequence" BIGINT NOT NULL,
    "original_quantity" DECIMAL(18,6) NOT NULL,
    "remaining_quantity" DECIMAL(18,6) NOT NULL,
    "original_unit_cost" DECIMAL(18,6) NOT NULL,
    "current_unit_cost" DECIMAL(18,6) NOT NULL,
    "original_total_cost" DECIMAL(18,2) NOT NULL,
    "current_total_cost" DECIMAL(18,2) NOT NULL,
    "current_remaining_value" DECIMAL(18,2) NOT NULL,
    "currency_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "calculation_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_cost_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_consumptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "outgoing_cost_movement_id" TEXT NOT NULL,
    "outgoing_inventory_movement_id" TEXT NOT NULL,
    "outgoing_document_type" TEXT NOT NULL,
    "outgoing_document_id" TEXT NOT NULL,
    "outgoing_document_line_id" TEXT,
    "cost_layer_id" TEXT,
    "source_incoming_cost_movement_id" TEXT,
    "consumed_quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "consumed_cost" DECIMAL(18,2) NOT NULL,
    "is_deficit_settlement" BOOLEAN NOT NULL DEFAULT false,
    "calculation_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_components" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cost_movement_id" TEXT NOT NULL,
    "component_type" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL,
    "currency_id" TEXT,
    "base_currency_amount" DECIMAL(18,2) NOT NULL,
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
    "counter_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "is_system_generated" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "journal_entry_id" TEXT,
    "inventory_impact" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cogs_impact" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expense_impact" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_cost_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_adjustment_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "adjustment_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "costing_key" TEXT,
    "cost_movement_id" TEXT,
    "source_cost_layer_id" TEXT,
    "quantity_reference" DECIMAL(18,6),
    "old_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_amount" DECIMAL(18,2) NOT NULL,
    "new_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impact_type" TEXT NOT NULL,
    "counter_mapping_key" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_calculation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_start" DATE,
    "from_date" DATE,
    "calculation_type" TEXT NOT NULL,
    "method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "initiated_by" TEXT,
    "source_trigger" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "movement_count" INTEGER NOT NULL DEFAULT 0,
    "adjustment_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "summary" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "inventory_cost_calculation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_costing_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "provisional_calculated_at" TIMESTAMP(3),
    "final_calculated_at" TIMESTAMP(3),
    "finalized_by" TEXT,
    "calculation_run_id" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopened_by" TEXT,
    "reopen_reason" TEXT,
    "summary" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_costing_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_costing_errors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "calculation_run_id" TEXT,
    "product_id" TEXT,
    "warehouse_id" TEXT,
    "costing_key" TEXT,
    "inventory_movement_id" TEXT,
    "cost_movement_id" TEXT,
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
CREATE TABLE "inventory_cost_balance_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "batch_id" TEXT,
    "period_end" DATE NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "average_cost" DECIMAL(18,6) NOT NULL,
    "open_layers" JSONB,
    "calculation_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_recalculation_requests" (
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
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "inventory_cost_recalculation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costing_accounting_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "period_start" DATE,
    "journal_entry_ids" TEXT[],
    "total_debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "entry_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "costing_accounting_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_costing_policies_tenant_id_organization_id_effect_idx" ON "inventory_costing_policies"("tenant_id", "organization_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_movements_source_inventory_movement_id_key" ON "inventory_cost_movements"("source_inventory_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_organization_id_costing__idx" ON "inventory_cost_movements"("tenant_id", "organization_id", "costing_key", "effective_date", "movement_sequence");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_source_document_type_sou_idx" ON "inventory_cost_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_organization_id_cost_sta_idx" ON "inventory_cost_movements"("tenant_id", "organization_id", "cost_status");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_product_id_idx" ON "inventory_cost_movements"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_calculation_run_id_idx" ON "inventory_cost_movements"("calculation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_layers_source_cost_movement_id_key" ON "inventory_cost_layers"("source_cost_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_layers_tenant_id_organization_id_costing_key_idx" ON "inventory_cost_layers"("tenant_id", "organization_id", "costing_key", "receipt_date", "movement_sequence");

-- CreateIndex
CREATE INDEX "inventory_cost_layers_tenant_id_source_document_type_source_idx" ON "inventory_cost_layers"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_cost_movemen_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_cost_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_cost_layer_id_idx" ON "inventory_cost_consumptions"("cost_layer_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_source_incoming_cost_movement_i_idx" ON "inventory_cost_consumptions"("source_incoming_cost_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_document_typ_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_document_type", "outgoing_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_components_cost_movement_id_idx" ON "inventory_cost_components"("cost_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_components_tenant_id_source_document_type_so_idx" ON "inventory_cost_components"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_adjustments_tenant_id_organization_id_docume_idx" ON "inventory_cost_adjustments"("tenant_id", "organization_id", "document_date");

-- CreateIndex
CREATE INDEX "inventory_cost_adjustments_calculation_run_id_idx" ON "inventory_cost_adjustments"("calculation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_adjustments_tenant_id_number_key" ON "inventory_cost_adjustments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "inventory_cost_adjustment_lines_adjustment_id_idx" ON "inventory_cost_adjustment_lines"("adjustment_id");

-- CreateIndex
CREATE INDEX "inventory_cost_adjustment_lines_cost_movement_id_idx" ON "inventory_cost_adjustment_lines"("cost_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_calculation_runs_tenant_id_organization_id_s_idx" ON "inventory_cost_calculation_runs"("tenant_id", "organization_id", "started_at");

-- CreateIndex
CREATE INDEX "inventory_costing_periods_tenant_id_organization_id_status_idx" ON "inventory_costing_periods"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_costing_periods_organization_id_period_start_key" ON "inventory_costing_periods"("organization_id", "period_start");

-- CreateIndex
CREATE INDEX "inventory_costing_errors_tenant_id_organization_id_resolved_idx" ON "inventory_costing_errors"("tenant_id", "organization_id", "resolved");

-- CreateIndex
CREATE INDEX "inventory_costing_errors_cost_movement_id_idx" ON "inventory_costing_errors"("cost_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_balance_snapshots_tenant_id_organization_id__idx" ON "inventory_cost_balance_snapshots"("tenant_id", "organization_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_cost_balance_snapshots_organization_id_costing_ke_key" ON "inventory_cost_balance_snapshots"("organization_id", "costing_key", "period_end");

-- CreateIndex
CREATE INDEX "inventory_cost_recalculation_requests_tenant_id_organizatio_idx" ON "inventory_cost_recalculation_requests"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "costing_accounting_batches_tenant_id_calculation_run_id_idx" ON "costing_accounting_batches"("tenant_id", "calculation_run_id");

-- AddForeignKey
ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_source_cost_movement_id_fkey" FOREIGN KEY ("source_cost_movement_id") REFERENCES "inventory_cost_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_consumptions" ADD CONSTRAINT "inventory_cost_consumptions_outgoing_cost_movement_id_fkey" FOREIGN KEY ("outgoing_cost_movement_id") REFERENCES "inventory_cost_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_consumptions" ADD CONSTRAINT "inventory_cost_consumptions_source_incoming_cost_movement__fkey" FOREIGN KEY ("source_incoming_cost_movement_id") REFERENCES "inventory_cost_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_consumptions" ADD CONSTRAINT "inventory_cost_consumptions_cost_layer_id_fkey" FOREIGN KEY ("cost_layer_id") REFERENCES "inventory_cost_layers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_components" ADD CONSTRAINT "inventory_cost_components_cost_movement_id_fkey" FOREIGN KEY ("cost_movement_id") REFERENCES "inventory_cost_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_adjustment_lines" ADD CONSTRAINT "inventory_cost_adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "inventory_cost_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

