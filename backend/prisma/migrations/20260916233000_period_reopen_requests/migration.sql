-- CreateTable
CREATE TABLE "period_reopen_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "period_reopen_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "period_reopen_requests_tenant_id_period_id_status_idx" ON "period_reopen_requests"("tenant_id", "period_id", "status");

-- AddForeignKey
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

