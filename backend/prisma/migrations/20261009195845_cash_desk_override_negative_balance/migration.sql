-- AlterTable
ALTER TABLE "cash_transactions" ADD COLUMN     "override_negative_balance" BOOLEAN NOT NULL DEFAULT false;
