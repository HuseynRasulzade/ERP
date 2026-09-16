-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApprovalStepType" AS ENUM ('PROCUREMENT_OFFICER', 'DEPARTMENT_HEAD', 'DIRECTOR', 'FINANCE', 'ACCOUNTING');

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "purchase_requirements" ADD COLUMN     "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "step_type" "ApprovalStepType" NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_steps_tenant_id_document_type_document_id_sequence_idx" ON "approval_steps"("tenant_id", "document_type", "document_id", "sequence");

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
