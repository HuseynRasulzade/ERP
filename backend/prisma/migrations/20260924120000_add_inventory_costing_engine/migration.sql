-- Phase 11: Inventory Costing Engine core tables

CREATE TABLE "inventory_costing_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "costing_method" TEXT NOT NULL,
    "average_method" TEXT,
    "valuation_currency_id" TEXT NOT NULL,
    "include_purchase_additional_costs" BOOLEAN NOT NULL DEFAULT true,
    "include_customs_cost" BOOLEAN NOT NULL DEFAULT true,
    "include_freight" BOOLEAN NOT NULL DEFAULT true,
    "allow_provisional_cost" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_quantity_costing" BOOLEAN NOT NULL DEFAULT true,
    "recalculate_backdated_documents" BOOLEAN NOT NULL DEFAULT true,
    "cost_by_warehouse" BOOLEAN NOT NULL DEFAULT true,
    "cost_by_characteristic" BOOLEAN NOT NULL DEFAULT false,
    "cost_by_batch" BOOLEAN NOT NULL DEFAULT false,
    "rounding_policy" TEXT NOT NULL DEFAULT 'STANDARD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    CONSTRAINT "inventory_costing_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_costing_policies_tenant_id_organization_id_effec_idx" ON "inventory_costing_policies"("tenant_id", "organization_id", "effective_from");

CREATE SEQUENCE "inventory_cost_layers_posting_sequence_seq" AS BIGINT;

CREATE TABLE "inventory_cost_layers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "batch_id" TEXT,
    "source_receipt_document_type" TEXT NOT NULL,
    "source_receipt_document_id" TEXT NOT NULL,
    "source_receipt_line_id" TEXT NOT NULL,
    "source_inventory_movement_id" TEXT NOT NULL,
    "receipt_date" TIMESTAMP(3) NOT NULL,
    "original_quantity" DECIMAL(18,6) NOT NULL,
    "remaining_quantity" DECIMAL(18,6) NOT NULL,
    "original_unit_cost" DECIMAL(18,6) NOT NULL,
    "current_unit_cost" DECIMAL(18,6) NOT NULL,
    "original_total_cost" DECIMAL(18,6) NOT NULL,
    "current_remaining_value" DECIMAL(18,6) NOT NULL,
    "currency_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "posting_sequence" BIGINT NOT NULL DEFAULT nextval('inventory_cost_layers_posting_sequence_seq'),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_cost_layers_pkey" PRIMARY KEY ("id")
);
ALTER SEQUENCE "inventory_cost_layers_posting_sequence_seq" OWNED BY "inventory_cost_layers"."posting_sequence";
CREATE INDEX "inventory_cost_layers_tenant_id_costing_key_status_receipt_idx" ON "inventory_cost_layers"("tenant_id", "costing_key", "status", "receipt_date", "posting_sequence");
CREATE INDEX "inventory_cost_layers_source_inventory_movement_id_idx" ON "inventory_cost_layers"("source_inventory_movement_id");

CREATE TABLE "inventory_cost_consumptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "outgoing_inventory_movement_id" TEXT NOT NULL,
    "outgoing_document_type" TEXT NOT NULL,
    "outgoing_document_id" TEXT NOT NULL,
    "outgoing_document_line_id" TEXT,
    "cost_layer_id" TEXT NOT NULL,
    "consumed_quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "consumed_cost" DECIMAL(18,6) NOT NULL,
    "calculation_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_cost_consumptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_cost_consumptions_cost_layer_id_fkey" FOREIGN KEY ("cost_layer_id") REFERENCES "inventory_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "inventory_cost_consumptions_outgoing_inventory_movement_id_idx" ON "inventory_cost_consumptions"("outgoing_inventory_movement_id");
CREATE INDEX "inventory_cost_consumptions_tenant_id_cost_layer_id_idx" ON "inventory_cost_consumptions"("tenant_id", "cost_layer_id");

CREATE TABLE "inventory_cost_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "ownership_type" TEXT NOT NULL DEFAULT 'OWN',
    "source_inventory_movement_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "posting_date" TIMESTAMP(3) NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "total_cost" DECIMAL(18,6) NOT NULL,
    "provisional_cost" DECIMAL(18,6),
    "final_cost" DECIMAL(18,6),
    "valuation_currency_id" TEXT NOT NULL,
    "posting_version" INTEGER NOT NULL DEFAULT 1,
    "cost_status" TEXT NOT NULL DEFAULT 'FINAL',
    "calculation_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_cost_movements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_cost_movements_source_inventory_movement_id_key" ON "inventory_cost_movements"("source_inventory_movement_id");
CREATE INDEX "inventory_cost_movements_tenant_id_costing_key_idx" ON "inventory_cost_movements"("tenant_id", "costing_key");
CREATE INDEX "inventory_cost_movements_tenant_id_product_id_idx" ON "inventory_cost_movements"("tenant_id", "product_id");

CREATE TABLE "inventory_cost_balances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "costing_key" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "total_value" DECIMAL(18,6) NOT NULL,
    "average_unit_cost" DECIMAL(18,6) NOT NULL,
    "currency_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_cost_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_cost_balances_tenant_id_costing_key_key" ON "inventory_cost_balances"("tenant_id", "costing_key");
