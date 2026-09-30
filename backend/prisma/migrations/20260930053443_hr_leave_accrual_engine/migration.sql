-- CreateTable
CREATE TABLE "hr_leave_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "annual_entitlement_days" DECIMAL(6,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "hr_leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_balance_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity_days" DECIMAL(6,2) NOT NULL,
    "effective_date" DATE NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "hr_leave_balance_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_accrual_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "employments_accrued" INTEGER NOT NULL,
    "total_days_accrued" DECIMAL(10,2) NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_by" TEXT,

    CONSTRAINT "hr_leave_accrual_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_leave_policies_organization_id_effective_from_idx" ON "hr_leave_policies"("organization_id", "effective_from");

-- CreateIndex
CREATE INDEX "hr_leave_balance_movements_employment_id_effective_date_idx" ON "hr_leave_balance_movements"("employment_id", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_accrual_runs_organization_id_period_year_period_mo_key" ON "hr_leave_accrual_runs"("organization_id", "period_year", "period_month");

-- AddForeignKey
ALTER TABLE "hr_leave_policies" ADD CONSTRAINT "hr_leave_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_policies" ADD CONSTRAINT "hr_leave_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_balance_movements" ADD CONSTRAINT "hr_leave_balance_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_balance_movements" ADD CONSTRAINT "hr_leave_balance_movements_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_accrual_runs" ADD CONSTRAINT "hr_leave_accrual_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_accrual_runs" ADD CONSTRAINT "hr_leave_accrual_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
