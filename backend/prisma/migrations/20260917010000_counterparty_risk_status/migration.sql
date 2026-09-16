-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "risk_note" TEXT,
ADD COLUMN     "risk_status" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "risk_updated_at" TIMESTAMP(3),
ADD COLUMN     "risk_updated_by" TEXT;
