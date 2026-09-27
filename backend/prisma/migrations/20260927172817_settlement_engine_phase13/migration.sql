-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "settlement_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "counterparty_id" TEXT NOT NULL,
    "counterparty_role" TEXT NOT NULL,
    "contract_id" TEXT,
    "settlement_dimension_type" TEXT NOT NULL DEFAULT 'BY_DOCUMENT',
    "open_item_id" TEXT,
    "currency_id" TEXT,
    "due_date" DATE,
    "movement_type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "exchange_rate" DECIMAL(24,10),
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_line_id" TEXT,
    "reversal_of_movement_id" TEXT,
    "effective_date" DATE NOT NULL,
    "posting_date" DATE NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "settlement_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_open_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "counterparty_role" TEXT NOT NULL,
    "item_type" TEXT NOT NULL DEFAULT 'RECEIVABLE',
    "contract_id" TEXT,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_document_number" TEXT,
    "schedule_line_sequence" INTEGER,
    "source_date" DATE NOT NULL,
    "due_date" DATE,
    "currency_id" TEXT,
    "original_amount" DECIMAL(18,2) NOT NULL,
    "original_base_amount" DECIMAL(18,2) NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "allocated_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(18,2) NOT NULL,
    "remaining_base_amount" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "disputed_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "blocked_for_payment" BOOLEAN NOT NULL DEFAULT false,
    "collection_status" TEXT NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_open_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_allocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payment_document_type" TEXT,
    "payment_document_id" TEXT,
    "payment_line_id" TEXT,
    "counterparty_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "target_open_item_id" TEXT NOT NULL,
    "source_open_item_id" TEXT,
    "allocation_date" DATE NOT NULL,
    "payment_currency_id" TEXT,
    "settlement_currency_id" TEXT,
    "payment_amount" DECIMAL(18,2) NOT NULL,
    "settlement_amount" DECIMAL(18,2) NOT NULL,
    "base_currency_amount" DECIMAL(18,2) NOT NULL,
    "exchange_rate" DECIMAL(24,10),
    "realized_fx_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "allocation_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,

    CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_offsets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "number" TEXT,
    "offset_date" DATE NOT NULL,
    "currency_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "settlement_offsets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_offset_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "settlement_offset_id" TEXT NOT NULL,
    "open_item_id" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "settlement_offset_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "operation_type" TEXT NOT NULL,
    "reason_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "debt_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_adjustment_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "debt_adjustment_id" TEXT NOT NULL,
    "open_item_id" TEXT,
    "target_contract_id" TEXT,
    "target_counterparty_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "debt_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_reconciliations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "currency_id" TEXT,
    "opening_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "debit_turnover" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_turnover" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closing_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "confirmed_by_us" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_by_counterparty" BOOLEAN NOT NULL DEFAULT false,
    "their_balance" DECIMAL(18,2),
    "difference_reason" TEXT,
    "signed_date" DATE,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_balance_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "currency_id" TEXT,
    "as_of_date" DATE NOT NULL,
    "receivable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "customer_advance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "supplier_advance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overdue_receivable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overdue_payable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_movements_tenant_id_organization_id_counterparty_idx" ON "settlement_movements"("tenant_id", "organization_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "settlement_movements_tenant_id_open_item_id_idx" ON "settlement_movements"("tenant_id", "open_item_id");

-- CreateIndex
CREATE INDEX "settlement_movements_tenant_id_source_document_type_source__idx" ON "settlement_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "settlement_movements_tenant_id_effective_date_idx" ON "settlement_movements"("tenant_id", "effective_date");

-- CreateIndex
CREATE INDEX "settlement_open_items_tenant_id_organization_id_counterpart_idx" ON "settlement_open_items"("tenant_id", "organization_id", "counterparty_id", "status");

-- CreateIndex
CREATE INDEX "settlement_open_items_tenant_id_source_document_type_source_idx" ON "settlement_open_items"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "settlement_open_items_tenant_id_item_type_status_idx" ON "settlement_open_items"("tenant_id", "item_type", "status");

-- CreateIndex
CREATE INDEX "settlement_open_items_tenant_id_due_date_idx" ON "settlement_open_items"("tenant_id", "due_date");

-- CreateIndex
CREATE INDEX "settlement_allocations_tenant_id_organization_id_counterpar_idx" ON "settlement_allocations"("tenant_id", "organization_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "settlement_allocations_tenant_id_target_open_item_id_idx" ON "settlement_allocations"("tenant_id", "target_open_item_id");

-- CreateIndex
CREATE INDEX "settlement_allocations_tenant_id_payment_document_type_paym_idx" ON "settlement_allocations"("tenant_id", "payment_document_type", "payment_document_id");

-- CreateIndex
CREATE INDEX "settlement_offset_lines_settlement_offset_id_idx" ON "settlement_offset_lines"("settlement_offset_id");

-- CreateIndex
CREATE INDEX "debt_adjustment_lines_debt_adjustment_id_idx" ON "debt_adjustment_lines"("debt_adjustment_id");

-- CreateIndex
CREATE INDEX "settlement_reconciliations_tenant_id_organization_id_counte_idx" ON "settlement_reconciliations"("tenant_id", "organization_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "settlement_balance_snapshots_tenant_id_organization_id_coun_idx" ON "settlement_balance_snapshots"("tenant_id", "organization_id", "counterparty_id", "as_of_date");

-- AddForeignKey
ALTER TABLE "settlement_movements" ADD CONSTRAINT "settlement_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_movements" ADD CONSTRAINT "settlement_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_movements" ADD CONSTRAINT "settlement_movements_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_movements" ADD CONSTRAINT "settlement_movements_open_item_id_fkey" FOREIGN KEY ("open_item_id") REFERENCES "settlement_open_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_open_items" ADD CONSTRAINT "settlement_open_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_open_items" ADD CONSTRAINT "settlement_open_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_open_items" ADD CONSTRAINT "settlement_open_items_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_target_open_item_id_fkey" FOREIGN KEY ("target_open_item_id") REFERENCES "settlement_open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_source_open_item_id_fkey" FOREIGN KEY ("source_open_item_id") REFERENCES "settlement_open_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_offsets" ADD CONSTRAINT "settlement_offsets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_offsets" ADD CONSTRAINT "settlement_offsets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_offsets" ADD CONSTRAINT "settlement_offsets_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_offset_lines" ADD CONSTRAINT "settlement_offset_lines_settlement_offset_id_fkey" FOREIGN KEY ("settlement_offset_id") REFERENCES "settlement_offsets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_offset_lines" ADD CONSTRAINT "settlement_offset_lines_open_item_id_fkey" FOREIGN KEY ("open_item_id") REFERENCES "settlement_open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustment_lines" ADD CONSTRAINT "debt_adjustment_lines_debt_adjustment_id_fkey" FOREIGN KEY ("debt_adjustment_id") REFERENCES "debt_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustment_lines" ADD CONSTRAINT "debt_adjustment_lines_open_item_id_fkey" FOREIGN KEY ("open_item_id") REFERENCES "settlement_open_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_reconciliations" ADD CONSTRAINT "settlement_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_reconciliations" ADD CONSTRAINT "settlement_reconciliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_reconciliations" ADD CONSTRAINT "settlement_reconciliations_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_balance_snapshots" ADD CONSTRAINT "settlement_balance_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_balance_snapshots" ADD CONSTRAINT "settlement_balance_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_balance_snapshots" ADD CONSTRAINT "settlement_balance_snapshots_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
