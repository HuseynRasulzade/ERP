-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "purchase_requirements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'PURCHASE_REQUIREMENT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "warehouse_id" TEXT,
    "department_id" TEXT,
    "requester_id" TEXT,
    "required_by_date" DATE,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requirement_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_requirement_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "cancelled_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "required_by_date" DATE,
    "warehouse_id" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "source_line_id" TEXT,
    "preferred_supplier_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "purchase_requirement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'PURCHASE_ORDER',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "currency_id" TEXT,
    "exchange_rate" DECIMAL(24,10),
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "price_includes_tax" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "warehouse_id" TEXT,
    "expected_delivery_date" DATE,
    "supplier_reference" TEXT,
    "purchase_channel" TEXT,
    "buyer_id" TEXT,
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

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "cancelled_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,6) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total_with_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "price_list_id" TEXT,
    "product_price_id" TEXT,
    "is_service" BOOLEAN NOT NULL DEFAULT false,
    "warehouse_id" TEXT,
    "expected_delivery_date" DATE,
    "supplier_product_code" TEXT,
    "requirement_line_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_delivery_schedule_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "planned_date" DATE NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "warehouse_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_delivery_schedule_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_holds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "hold_type" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placed_by" TEXT,
    "released_at" TIMESTAMP(3),
    "released_by" TEXT,

    CONSTRAINT "purchase_order_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_payment_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'AFTER_RECEIPT',
    "percentage" DECIMAL(9,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_product_codes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "supplier_unit_id" TEXT,
    "moq" DECIMAL(18,6),
    "order_multiple" DECIMAL(18,6),
    "lead_time_days" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supplier_product_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_pegs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "demand_type" TEXT NOT NULL,
    "demand_id" TEXT NOT NULL,
    "demand_line_id" TEXT NOT NULL,
    "supply_type" TEXT NOT NULL,
    "supply_id" TEXT NOT NULL,
    "supply_line_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "supply_pegs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_requirements_organization_id_status_idx" ON "purchase_requirements"("organization_id", "status");

-- CreateIndex
CREATE INDEX "purchase_requirements_organization_id_warehouse_id_idx" ON "purchase_requirements"("organization_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "purchase_requirements_organization_id_required_by_date_idx" ON "purchase_requirements"("organization_id", "required_by_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requirements_tenant_id_number_key" ON "purchase_requirements"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_requirement_lines_purchase_requirement_id_position_idx" ON "purchase_requirement_lines"("purchase_requirement_id", "position");

-- CreateIndex
CREATE INDEX "purchase_requirement_lines_tenant_id_product_id_idx" ON "purchase_requirement_lines"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "purchase_requirement_lines_tenant_id_source_document_type_s_idx" ON "purchase_requirement_lines"("tenant_id", "source_document_type", "source_document_id", "source_line_id");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_counterparty_id_status_idx" ON "purchase_orders"("organization_id", "counterparty_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_expected_delivery_date_idx" ON "purchase_orders"("organization_id", "expected_delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_number_key" ON "purchase_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_position_idx" ON "purchase_order_lines"("purchase_order_id", "position");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_product_id_idx" ON "purchase_order_lines"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_requirement_line_id_idx" ON "purchase_order_lines"("tenant_id", "requirement_line_id");

-- CreateIndex
CREATE INDEX "purchase_delivery_schedule_lines_purchase_order_line_id_pla_idx" ON "purchase_delivery_schedule_lines"("purchase_order_line_id", "planned_date");

-- CreateIndex
CREATE INDEX "purchase_order_holds_purchase_order_id_status_idx" ON "purchase_order_holds"("purchase_order_id", "status");

-- CreateIndex
CREATE INDEX "purchase_order_payment_schedules_purchase_order_id_sequence_idx" ON "purchase_order_payment_schedules"("purchase_order_id", "sequence");

-- CreateIndex
CREATE INDEX "supplier_product_codes_organization_id_counterparty_id_supp_idx" ON "supplier_product_codes"("organization_id", "counterparty_id", "supplier_code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_product_codes_organization_id_counterparty_id_prod_key" ON "supplier_product_codes"("organization_id", "counterparty_id", "product_id");

-- CreateIndex
CREATE INDEX "supply_pegs_tenant_id_demand_type_demand_id_demand_line_id_idx" ON "supply_pegs"("tenant_id", "demand_type", "demand_id", "demand_line_id");

-- CreateIndex
CREATE INDEX "supply_pegs_tenant_id_supply_type_supply_id_supply_line_id_idx" ON "supply_pegs"("tenant_id", "supply_type", "supply_id", "supply_line_id");

-- AddForeignKey
ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirement_lines" ADD CONSTRAINT "purchase_requirement_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirement_lines" ADD CONSTRAINT "purchase_requirement_lines_purchase_requirement_id_fkey" FOREIGN KEY ("purchase_requirement_id") REFERENCES "purchase_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirement_lines" ADD CONSTRAINT "purchase_requirement_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirement_lines" ADD CONSTRAINT "purchase_requirement_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirement_lines" ADD CONSTRAINT "purchase_requirement_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requirement_lines" ADD CONSTRAINT "purchase_requirement_lines_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_delivery_schedule_lines" ADD CONSTRAINT "purchase_delivery_schedule_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_delivery_schedule_lines" ADD CONSTRAINT "purchase_delivery_schedule_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_delivery_schedule_lines" ADD CONSTRAINT "purchase_delivery_schedule_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_holds" ADD CONSTRAINT "purchase_order_holds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_holds" ADD CONSTRAINT "purchase_order_holds_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_payment_schedules" ADD CONSTRAINT "purchase_order_payment_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_payment_schedules" ADD CONSTRAINT "purchase_order_payment_schedules_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_payment_schedules" ADD CONSTRAINT "purchase_order_payment_schedules_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_supplier_unit_id_fkey" FOREIGN KEY ("supplier_unit_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_pegs" ADD CONSTRAINT "supply_pegs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

