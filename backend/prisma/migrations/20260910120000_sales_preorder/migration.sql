-- AlterTable
ALTER TABLE "sales_order_lines" ADD COLUMN     "cancelled_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "fulfillment_policy" TEXT NOT NULL DEFAULT 'ALLOW_PARTIAL',
ADD COLUMN     "is_service" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reservation_policy" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "warehouse_id" TEXT;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "approval_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "credit_status" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
ADD COLUMN     "external_reference" TEXT,
ADD COLUMN     "fulfillment_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "order_payment_status" TEXT NOT NULL DEFAULT 'NOT_PAID',
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "promised_delivery_date" DATE,
ADD COLUMN     "requested_delivery_date" DATE,
ADD COLUMN     "reservation_status" TEXT NOT NULL DEFAULT 'NOT_RESERVED',
ADD COLUMN     "sales_channel" TEXT,
ADD COLUMN     "shipment_payment_policy" TEXT NOT NULL DEFAULT 'NO_RESTRICTION',
ADD COLUMN     "source_offer_id" TEXT,
ADD COLUMN     "warehouse_id" TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "customer_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'CUSTOMER_REQUEST',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "currency_id" TEXT,
    "requested_delivery_date" DATE,
    "sales_manager_id" TEXT,
    "source_channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "external_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_request_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_request_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "requested_price" DECIMAL(18,6),
    "requested_delivery_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_offers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'COMMERCIAL_OFFER',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "valid_until" DATE,
    "counterparty_id" TEXT NOT NULL,
    "currency_id" TEXT,
    "price_includes_tax" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "source_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "sent_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commercial_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_offer_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "commercial_offer_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "discount_percent" DECIMAL(9,4),
    "discount_amount" DECIMAL(18,2),
    "line_total" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total_with_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "price_list_id" TEXT,
    "product_price_id" TEXT,
    "expected_delivery_date" DATE,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commercial_offer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_line_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_line_id" TEXT NOT NULL,
    "target_document_type" TEXT NOT NULL,
    "target_document_id" TEXT NOT NULL,
    "target_line_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(18,2),
    "relation_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "document_line_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_line_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reservation_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "released_at" TIMESTAMP(3),
    "released_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "planned_date" DATE NOT NULL,
    "warehouse_id" TEXT,
    "delivery_address" TEXT,
    "carrier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "shipment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_plan_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shipment_plan_id" TEXT NOT NULL,
    "sales_order_line_id" TEXT NOT NULL,
    "planned_quantity" DECIMAL(18,6) NOT NULL,
    "warehouse_id" TEXT,
    "planned_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_plan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_payment_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "percentage" DECIMAL(9,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_id" TEXT,
    "schedule_type" TEXT NOT NULL DEFAULT 'INSTALLMENT',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_holds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "hold_type" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placed_by" TEXT,
    "released_at" TIMESTAMP(3),
    "released_by" TEXT,

    CONSTRAINT "order_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_requests_tenant_id_document_date_idx" ON "customer_requests"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "customer_requests_organization_id_counterparty_id_idx" ON "customer_requests"("organization_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "customer_requests_organization_id_status_idx" ON "customer_requests"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_requests_tenant_id_number_key" ON "customer_requests"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "customer_request_lines_customer_request_id_position_idx" ON "customer_request_lines"("customer_request_id", "position");

-- CreateIndex
CREATE INDEX "commercial_offers_tenant_id_document_date_idx" ON "commercial_offers"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "commercial_offers_organization_id_counterparty_id_idx" ON "commercial_offers"("organization_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "commercial_offers_organization_id_status_idx" ON "commercial_offers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_offers_tenant_id_number_key" ON "commercial_offers"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "commercial_offer_lines_commercial_offer_id_position_idx" ON "commercial_offer_lines"("commercial_offer_id", "position");

-- CreateIndex
CREATE INDEX "document_line_links_tenant_id_source_document_type_source_d_idx" ON "document_line_links"("tenant_id", "source_document_type", "source_document_id", "source_line_id");

-- CreateIndex
CREATE INDEX "document_line_links_tenant_id_target_document_type_target_d_idx" ON "document_line_links"("tenant_id", "target_document_type", "target_document_id");

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_organization_id_product_id_war_idx" ON "stock_reservations"("tenant_id", "organization_id", "product_id", "warehouse_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_source_document_type_source_do_idx" ON "stock_reservations"("tenant_id", "source_document_type", "source_document_id", "source_line_id");

-- CreateIndex
CREATE INDEX "shipment_plans_tenant_id_sales_order_id_idx" ON "shipment_plans"("tenant_id", "sales_order_id");

-- CreateIndex
CREATE INDEX "shipment_plan_lines_shipment_plan_id_idx" ON "shipment_plan_lines"("shipment_plan_id");

-- CreateIndex
CREATE INDEX "shipment_plan_lines_sales_order_line_id_idx" ON "shipment_plan_lines"("sales_order_line_id");

-- CreateIndex
CREATE INDEX "order_payment_schedules_sales_order_id_sequence_idx" ON "order_payment_schedules"("sales_order_id", "sequence");

-- CreateIndex
CREATE INDEX "order_holds_sales_order_id_status_idx" ON "order_holds"("sales_order_id", "status");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_fulfillment_status_idx" ON "sales_orders"("organization_id", "fulfillment_status");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_credit_status_idx" ON "sales_orders"("organization_id", "credit_status");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_source_offer_id_fkey" FOREIGN KEY ("source_offer_id") REFERENCES "commercial_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_sales_manager_id_fkey" FOREIGN KEY ("sales_manager_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_lines" ADD CONSTRAINT "customer_request_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_lines" ADD CONSTRAINT "customer_request_lines_customer_request_id_fkey" FOREIGN KEY ("customer_request_id") REFERENCES "customer_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_lines" ADD CONSTRAINT "customer_request_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_lines" ADD CONSTRAINT "customer_request_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "customer_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_lines" ADD CONSTRAINT "commercial_offer_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_lines" ADD CONSTRAINT "commercial_offer_lines_commercial_offer_id_fkey" FOREIGN KEY ("commercial_offer_id") REFERENCES "commercial_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_lines" ADD CONSTRAINT "commercial_offer_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_lines" ADD CONSTRAINT "commercial_offer_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_line_links" ADD CONSTRAINT "document_line_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_plans" ADD CONSTRAINT "shipment_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_plans" ADD CONSTRAINT "shipment_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_plans" ADD CONSTRAINT "shipment_plans_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_plans" ADD CONSTRAINT "shipment_plans_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_plan_lines" ADD CONSTRAINT "shipment_plan_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_plan_lines" ADD CONSTRAINT "shipment_plan_lines_shipment_plan_id_fkey" FOREIGN KEY ("shipment_plan_id") REFERENCES "shipment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_plan_lines" ADD CONSTRAINT "shipment_plan_lines_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payment_schedules" ADD CONSTRAINT "order_payment_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payment_schedules" ADD CONSTRAINT "order_payment_schedules_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payment_schedules" ADD CONSTRAINT "order_payment_schedules_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_holds" ADD CONSTRAINT "order_holds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_holds" ADD CONSTRAINT "order_holds_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

