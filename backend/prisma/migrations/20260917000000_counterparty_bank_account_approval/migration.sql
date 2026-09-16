-- AlterTable
ALTER TABLE "counterparty_bank_accounts" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';
