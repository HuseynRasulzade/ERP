-- AlterEnum
ALTER TYPE "ApprovalStepType" ADD VALUE 'WAREHOUSE_SUPERVISOR';

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "goods_receipt_lines" ADD COLUMN "over_receipt_reason" TEXT;

-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED';
