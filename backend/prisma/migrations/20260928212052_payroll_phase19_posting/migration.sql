-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "payroll_postings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'PAYROLL_POSTING',
    "number" TEXT,
    "payroll_period_id" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "posting_status" TEXT NOT NULL DEFAULT 'NOT_POSTED',
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_employer_contributions" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payroll_postings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_postings_payroll_period_id_key" ON "payroll_postings"("payroll_period_id");

-- CreateIndex
CREATE INDEX "payroll_postings_organization_id_posting_status_idx" ON "payroll_postings"("organization_id", "posting_status");

-- AddForeignKey
ALTER TABLE "payroll_postings" ADD CONSTRAINT "payroll_postings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_postings" ADD CONSTRAINT "payroll_postings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_postings" ADD CONSTRAINT "payroll_postings_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
