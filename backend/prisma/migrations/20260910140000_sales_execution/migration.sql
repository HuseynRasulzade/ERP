-- AlterTable
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "source_shipment_line_id" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "amount_due" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "settlement_status" TEXT NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "source_shipment_id" TEXT,
ADD COLUMN     "tax_point_date" DATE;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'SHIPMENT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "customer_order_id" TEXT,
    "counterparty_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "delivery_address_snapshot" TEXT,
    "delivery_method" TEXT,
    "carrier" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
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

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "source_order_line_id" TEXT,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "warehouse_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_obligations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "currency_id" TEXT,
    "amount_due" DECIMAL(18,2) NOT NULL,
    "due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'NOT_PAID',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'SALES_RETURN',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "original_sales_invoice_id" TEXT,
    "counterparty_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "currency_id" TEXT,
    "return_type" TEXT NOT NULL DEFAULT 'PHYSICAL_RETURN',
    "reason_code" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sales_return_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "source_invoice_line_id" TEXT,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "original_unit_price" DECIMAL(18,6) NOT NULL,
    "return_net" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "return_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "return_gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipments_tenant_id_document_date_idx" ON "shipments"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "shipments_organization_id_customer_order_id_idx" ON "shipments"("organization_id", "customer_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_tenant_id_number_key" ON "shipments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "shipment_lines_shipment_id_position_idx" ON "shipment_lines"("shipment_id", "position");

-- CreateIndex
CREATE INDEX "settlement_obligations_tenant_id_source_document_type_sourc_idx" ON "settlement_obligations"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "settlement_obligations_organization_id_counterparty_id_stat_idx" ON "settlement_obligations"("organization_id", "counterparty_id", "status");

-- CreateIndex
CREATE INDEX "sales_returns_tenant_id_document_date_idx" ON "sales_returns"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "sales_returns_organization_id_original_sales_invoice_id_idx" ON "sales_returns"("organization_id", "original_sales_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_tenant_id_number_key" ON "sales_returns"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sales_return_lines_sales_return_id_position_idx" ON "sales_return_lines"("sales_return_id", "position");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_source_shipment_id_fkey" FOREIGN KEY ("source_shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_obligations" ADD CONSTRAINT "settlement_obligations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_obligations" ADD CONSTRAINT "settlement_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_obligations" ADD CONSTRAINT "settlement_obligations_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_obligations" ADD CONSTRAINT "settlement_obligations_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_original_sales_invoice_id_fkey" FOREIGN KEY ("original_sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

