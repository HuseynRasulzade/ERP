-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "supplier_order_id" TEXT,
    "document_type" TEXT NOT NULL DEFAULT 'GOODS_RECEIPT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "currency_id" TEXT,
    "exchange_rate" DECIMAL(24,10),
    "operation_type" TEXT NOT NULL DEFAULT 'PURCHASE_FROM_SUPPLIER',
    "supplier_document_number" TEXT,
    "supplier_document_date" DATE,
    "external_reference" TEXT,
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

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "goods_receipt_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "warehouse_id" TEXT,
    "price" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "supplier_order_line_id" TEXT,
    "country_of_origin" TEXT,
    "customs_declaration" TEXT,
    "expiry_date" DATE,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'PURCHASE_INVOICE',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "due_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "currency_id" TEXT,
    "exchange_rate" DECIMAL(24,10),
    "supplier_invoice_number" TEXT,
    "supplier_invoice_date" DATE,
    "supplier_order_id" TEXT,
    "goods_receipt_id" TEXT,
    "price_includes_tax" BOOLEAN NOT NULL DEFAULT false,
    "tax_point_date" DATE,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_due" DECIMAL(18,2) NOT NULL DEFAULT 0,
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

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_invoice_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "line_type" TEXT NOT NULL DEFAULT 'INVENTORY',
    "product_id" TEXT,
    "unit_id" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "price" DECIMAL(18,6) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total_with_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "warehouse_id" TEXT,
    "expense_account_id" TEXT,
    "department_id" TEXT,
    "goods_receipt_line_id" TEXT,
    "supplier_order_line_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payables" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL DEFAULT 'PURCHASE_INVOICE',
    "source_document_id" TEXT NOT NULL,
    "currency_id" TEXT,
    "invoice_amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'PURCHASE_RETURN',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "original_goods_receipt_id" TEXT,
    "original_purchase_invoice_id" TEXT,
    "counterparty_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "currency_id" TEXT,
    "return_reason" TEXT,
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

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_return_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "source_receipt_line_id" TEXT,
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

    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_purchase_costs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'ADDITIONAL_PURCHASE_COST',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "currency_id" TEXT,
    "cost_type" TEXT NOT NULL DEFAULT 'OTHER',
    "allocation_method" TEXT NOT NULL DEFAULT 'BY_VALUE',
    "totalCost" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "additional_purchase_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_purchase_cost_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "additional_purchase_cost_id" TEXT NOT NULL,
    "goods_receipt_line_id" TEXT NOT NULL,
    "manual_coefficient" DECIMAL(18,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "additional_purchase_cost_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_cost_allocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "additional_purchase_cost_id" TEXT NOT NULL,
    "goods_receipt_line_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_matching_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_invoice_id" TEXT NOT NULL,
    "overall_status" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by" TEXT,

    CONSTRAINT "purchase_matching_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goods_receipts_organization_id_counterparty_id_status_idx" ON "goods_receipts"("organization_id", "counterparty_id", "status");

-- CreateIndex
CREATE INDEX "goods_receipts_organization_id_supplier_order_id_idx" ON "goods_receipts"("organization_id", "supplier_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_number_key" ON "goods_receipts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_goods_receipt_id_position_idx" ON "goods_receipt_lines"("goods_receipt_id", "position");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_tenant_id_product_id_idx" ON "goods_receipt_lines"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_tenant_id_supplier_order_line_id_idx" ON "goods_receipt_lines"("tenant_id", "supplier_order_line_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_tenant_id_number_idx" ON "purchase_invoices"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_invoices_organization_id_counterparty_id_status_idx" ON "purchase_invoices"("organization_id", "counterparty_id", "status");

-- CreateIndex
CREATE INDEX "purchase_invoices_organization_id_goods_receipt_id_idx" ON "purchase_invoices"("organization_id", "goods_receipt_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_organization_id_supplier_order_id_idx" ON "purchase_invoices"("organization_id", "supplier_order_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_organization_id_due_date_idx" ON "purchase_invoices"("organization_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_organization_id_counterparty_id_supplier__key" ON "purchase_invoices"("organization_id", "counterparty_id", "supplier_invoice_number");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_purchase_invoice_id_position_idx" ON "purchase_invoice_lines"("purchase_invoice_id", "position");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_tenant_id_product_id_idx" ON "purchase_invoice_lines"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_tenant_id_goods_receipt_line_id_idx" ON "purchase_invoice_lines"("tenant_id", "goods_receipt_line_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_tenant_id_supplier_order_line_id_idx" ON "purchase_invoice_lines"("tenant_id", "supplier_order_line_id");

-- CreateIndex
CREATE INDEX "supplier_payables_tenant_id_source_document_type_source_doc_idx" ON "supplier_payables"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "supplier_payables_organization_id_counterparty_id_status_idx" ON "supplier_payables"("organization_id", "counterparty_id", "status");

-- CreateIndex
CREATE INDEX "purchase_returns_tenant_id_document_date_idx" ON "purchase_returns"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "purchase_returns_organization_id_original_goods_receipt_id_idx" ON "purchase_returns"("organization_id", "original_goods_receipt_id");

-- CreateIndex
CREATE INDEX "purchase_returns_organization_id_original_purchase_invoice__idx" ON "purchase_returns"("organization_id", "original_purchase_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_tenant_id_number_key" ON "purchase_returns"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_return_lines_purchase_return_id_position_idx" ON "purchase_return_lines"("purchase_return_id", "position");

-- CreateIndex
CREATE INDEX "additional_purchase_costs_organization_id_counterparty_id_s_idx" ON "additional_purchase_costs"("organization_id", "counterparty_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "additional_purchase_costs_tenant_id_number_key" ON "additional_purchase_costs"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "additional_purchase_cost_lines_additional_purchase_cost_id_idx" ON "additional_purchase_cost_lines"("additional_purchase_cost_id");

-- CreateIndex
CREATE INDEX "purchase_cost_allocations_additional_purchase_cost_id_idx" ON "purchase_cost_allocations"("additional_purchase_cost_id");

-- CreateIndex
CREATE INDEX "purchase_cost_allocations_tenant_id_goods_receipt_line_id_idx" ON "purchase_cost_allocations"("tenant_id", "goods_receipt_line_id");

-- CreateIndex
CREATE INDEX "purchase_matching_results_tenant_id_purchase_invoice_id_idx" ON "purchase_matching_results"("tenant_id", "purchase_invoice_id");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_original_goods_receipt_id_fkey" FOREIGN KEY ("original_goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_original_purchase_invoice_id_fkey" FOREIGN KEY ("original_purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_purchase_costs" ADD CONSTRAINT "additional_purchase_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_purchase_costs" ADD CONSTRAINT "additional_purchase_costs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_purchase_costs" ADD CONSTRAINT "additional_purchase_costs_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_purchase_costs" ADD CONSTRAINT "additional_purchase_costs_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_purchase_cost_lines" ADD CONSTRAINT "additional_purchase_cost_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_purchase_cost_lines" ADD CONSTRAINT "additional_purchase_cost_lines_additional_purchase_cost_id_fkey" FOREIGN KEY ("additional_purchase_cost_id") REFERENCES "additional_purchase_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_purchase_cost_lines" ADD CONSTRAINT "additional_purchase_cost_lines_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_cost_allocations" ADD CONSTRAINT "purchase_cost_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_cost_allocations" ADD CONSTRAINT "purchase_cost_allocations_additional_purchase_cost_id_fkey" FOREIGN KEY ("additional_purchase_cost_id") REFERENCES "additional_purchase_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_matching_results" ADD CONSTRAINT "purchase_matching_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_matching_results" ADD CONSTRAINT "purchase_matching_results_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

