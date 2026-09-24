-- AlterTable
ALTER TABLE "bank_statement_lines" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "bank_statement_lines" ADD COLUMN "updated_by" TEXT;
ALTER TABLE "bank_statement_lines" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
