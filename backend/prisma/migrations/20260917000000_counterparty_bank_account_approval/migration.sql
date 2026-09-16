-- AlterTable
ALTER TABLE "counterparty_bank_accounts" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "counterparty_bank_account_id" TEXT;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_counterparty_bank_account_id_fkey" FOREIGN KEY ("counterparty_bank_account_id") REFERENCES "counterparty_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
