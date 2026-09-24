-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "inventory_costing_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "costing_method" TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "average_method" TEXT NOT NULL DEFAULT 'MOVING_AVERAGE',
    "valuation_currency_id" TEXT,
    "include_purchase_additional_costs" BOOLEAN NOT NULL DEFAULT true,
    "include_customs_cost" BOOLEAN NOT NULL DEFAULT true,
    "include_freight" BOOLEAN NOT NULL DEFAULT true,
    "allow_provisional_cost" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_quantity_costing" BOOLEAN NOT NULL DEFAULT true,
    "negative_stock_cost_policy" TEXT NOT NULL DEFAULT 'LAST_KNOWN_COST',
    "recalculate_backdated_documents" BOOLEAN NOT NULL DEFAULT true,
    "cost_by_warehouse" BOOLEAN NOT NULL DEFAULT true,
    "cost_by_characteristic" BOOLEAN NOT NULL DEFAULT false,
    "cost_by_batch" BOOLEAN NOT NULL DEFAULT false,
    "rounding_precision" INTEGER NOT NULL DEFAULT 2,
    "consignment_included_in_valuation" BOOLEAN NOT NULL DEFAULT false,
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
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "source_inventory_movement_id" TEXT,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "effective_date" DATE NOT NULL,
    "posting_sequence" BIGSERIAL NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6),
    "total_cost" DECIMAL(18,2) NOT NULL,
    "provisional_cost" BOOLEAN NOT NULL DEFAULT false,
    "cost_status" TEXT NOT NULL DEFAULT 'UNCALCULATED',
    "calculation_run_id" TEXT,
    "currency_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

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
    "source_receipt_document_type" TEXT,
    "source_receipt_document_id" TEXT,
    "source_receipt_line_id" TEXT,
    "source_inventory_movement_id" TEXT,
    "receipt_date" DATE NOT NULL,
    "posting_sequence" BIGSERIAL NOT NULL,
    "original_quantity" DECIMAL(18,6) NOT NULL,
    "remaining_quantity" DECIMAL(18,6) NOT NULL,
    "original_unit_cost" DECIMAL(18,6) NOT NULL,
    "current_unit_cost" DECIMAL(18,6) NOT NULL,
    "original_total_cost" DECIMAL(18,2) NOT NULL,
    "current_remaining_value" DECIMAL(18,2) NOT NULL,
    "currency_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_consumptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cost_layer_id" TEXT NOT NULL,
    "outgoing_inventory_movement_id" TEXT NOT NULL,
    "outgoing_document_type" TEXT NOT NULL,
    "outgoing_document_id" TEXT NOT NULL,
    "outgoing_document_line_id" TEXT,
    "consumed_quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "consumed_cost" DECIMAL(18,2) NOT NULL,
    "calculation_run_id" TEXT,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_consumptions_pkey" PRIMARY KEY ("id")
);

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

-- CreateIndex
CREATE INDEX "inventory_costing_policies_tenant_id_organization_id_effect_idx" ON "inventory_costing_policies"("tenant_id", "organization_id", "effective_from");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_costing_key_effective_da_idx" ON "inventory_cost_movements"("tenant_id", "costing_key", "effective_date", "posting_sequence");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_source_document_type_sou_idx" ON "inventory_cost_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_source_inventory_movemen_idx" ON "inventory_cost_movements"("tenant_id", "source_inventory_movement_id");

-- CreateIndex
CREATE INDEX "inventory_cost_movements_tenant_id_calculation_run_id_idx" ON "inventory_cost_movements"("tenant_id", "calculation_run_id");

-- CreateIndex
CREATE INDEX "inventory_cost_layers_tenant_id_costing_key_status_receipt__idx" ON "inventory_cost_layers"("tenant_id", "costing_key", "status", "receipt_date", "posting_sequence");

-- CreateIndex
CREATE INDEX "inventory_cost_layers_tenant_id_source_receipt_document_typ_idx" ON "inventory_cost_layers"("tenant_id", "source_receipt_document_type", "source_receipt_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_document_typ_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_document_type", "outgoing_document_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_document_lin_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_document_line_id");

-- CreateIndex
CREATE INDEX "inventory_cost_consumptions_tenant_id_outgoing_inventory_mo_idx" ON "inventory_cost_consumptions"("tenant_id", "outgoing_inventory_movement_id");

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
ALTER TABLE "inventory_cost_consumptions" ADD CONSTRAINT "inventory_cost_consumptions_cost_layer_id_fkey" FOREIGN KEY ("cost_layer_id") REFERENCES "inventory_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
