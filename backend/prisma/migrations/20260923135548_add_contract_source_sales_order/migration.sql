-- AlterTable
ALTER TABLE "counterparty_contracts" ADD COLUMN "source_sales_order_id" TEXT;

-- AlterTable
ALTER TABLE "counterparty_contract_lines" ADD COLUMN "source_sales_order_line_id" TEXT;

-- CreateIndex
CREATE INDEX "counterparty_contract_lines_tenant_id_source_sales_order_line_id_idx" ON "counterparty_contract_lines"("tenant_id", "source_sales_order_line_id");
