-- Phase 4 — Sales documents (orders + invoices).
-- Creates sales_orders + sales_order_lines and sales_invoices +
-- sales_invoice_lines, mirroring the Phase 4 schema models. Follows the
-- phase2/phase3 migration conventions: RESTRICT FKs to tenants/orgs/
-- counterparties/products/units (currency nullable -> SET NULL), CASCADE
-- from lines to their header, composite indexes matching the schema.

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'SALES_ORDER',
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

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total_with_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "price_list_id" TEXT,
    "product_price_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'SALES_INVOICE',
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

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sales_invoice_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total_with_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "price_list_id" TEXT,
    "product_price_id" TEXT,
    "source_order_line_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_document_date_idx" ON "sales_orders"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_status_idx" ON "sales_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_counterparty_id_idx" ON "sales_orders"("organization_id", "counterparty_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenant_id_number_key" ON "sales_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sales_order_lines_sales_order_id_position_idx" ON "sales_order_lines"("sales_order_id", "position");

-- CreateIndex
CREATE INDEX "sales_order_lines_tenant_id_product_id_idx" ON "sales_order_lines"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "sales_invoices_tenant_id_document_date_idx" ON "sales_invoices"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "sales_invoices_tenant_id_status_idx" ON "sales_invoices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sales_invoices_organization_id_counterparty_id_idx" ON "sales_invoices"("organization_id", "counterparty_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_tenant_id_number_key" ON "sales_invoices"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_sales_invoice_id_position_idx" ON "sales_invoice_lines"("sales_invoice_id", "position");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_tenant_id_product_id_idx" ON "sales_invoice_lines"("tenant_id", "product_id");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
