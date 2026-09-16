-- AlterTable
ALTER TABLE "counterparty_contracts" ADD COLUMN "limit_amount" DECIMAL(18,2);
ALTER TABLE "counterparty_contracts" ADD COLUMN "limit_policy" TEXT NOT NULL DEFAULT 'WARN';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN "contract_id" TEXT;
