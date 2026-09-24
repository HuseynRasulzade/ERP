-- AlterTable
ALTER TABLE "settlement_obligations" ADD COLUMN "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "cash_transactions" ADD COLUMN "source_sales_invoice_id" TEXT;
ALTER TABLE "cash_transactions" ADD COLUMN "source_purchase_invoice_id" TEXT;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_source_sales_invoice_id_fkey" FOREIGN KEY ("source_sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_source_purchase_invoice_id_fkey" FOREIGN KEY ("source_purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
