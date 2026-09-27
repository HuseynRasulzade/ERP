-- AlterTable
ALTER TABLE "cash_transactions" ADD COLUMN     "cashier_id" TEXT,
ADD COLUMN     "employee_id" TEXT;

-- AlterTable
ALTER TABLE "cashboxes" ADD COLUMN     "cash_desk_type" TEXT NOT NULL DEFAULT 'MAIN_CASH',
ADD COLUMN     "max_cash_limit" DECIMAL(18,2),
ADD COLUMN     "negative_balance_policy" TEXT NOT NULL DEFAULT 'NEVER',
ADD COLUMN     "require_daily_close" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "require_denomination_count" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "cashier_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cashbox_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cashier_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accountable_person_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "currency_id" TEXT,
    "movementType" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "accountable_person_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_desk_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'CASH_DESK_TRANSFER',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "source_cashbox_id" TEXT NOT NULL,
    "destination_cashbox_id" TEXT NOT NULL,
    "currency_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "transfer_mode" TEXT NOT NULL DEFAULT 'INSTANT',
    "transfer_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "received_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
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

    CONSTRAINT "cash_desk_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_denominations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "currency_id" TEXT NOT NULL,
    "face_value" DECIMAL(18,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "currency_denominations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_physical_counts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cashbox_id" TEXT NOT NULL,
    "cashier_id" TEXT,
    "count_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "book_balance" DECIMAL(18,2) NOT NULL,
    "physical_balance" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "count_method" TEXT NOT NULL DEFAULT 'OPEN',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cash_physical_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_denomination_count_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "face_value" DECIMAL(18,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "cash_denomination_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_count_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'CASH_COUNT_ADJUSTMENT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "cashbox_id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "adjustment_type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason_code" TEXT,
    "responsible_person_id" TEXT,
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

    CONSTRAINT "cash_count_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_desk_daily_closes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cashbox_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "cashier_id" TEXT,
    "opening_book_balance" DECIMAL(18,2) NOT NULL,
    "total_receipts" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_expenses" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closing_book_balance" DECIMAL(18,2) NOT NULL,
    "physical_count_id" TEXT,
    "difference" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "reopen_reason" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopened_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cash_desk_daily_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier_handovers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cashbox_id" TEXT NOT NULL,
    "outgoing_cashier_id" TEXT NOT NULL,
    "incoming_cashier_id" TEXT NOT NULL,
    "handover_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "book_balance" DECIMAL(18,2) NOT NULL,
    "physical_balance" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "denomination_count_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cashier_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cashier_assignments_organization_id_cashbox_id_status_idx" ON "cashier_assignments"("organization_id", "cashbox_id", "status");

-- CreateIndex
CREATE INDEX "cashier_assignments_person_id_status_idx" ON "cashier_assignments"("person_id", "status");

-- CreateIndex
CREATE INDEX "accountable_person_movements_tenant_id_organization_id_pers_idx" ON "accountable_person_movements"("tenant_id", "organization_id", "person_id");

-- CreateIndex
CREATE INDEX "accountable_person_movements_tenant_id_source_document_type_idx" ON "accountable_person_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "cash_desk_transfers_organization_id_source_cashbox_id_idx" ON "cash_desk_transfers"("organization_id", "source_cashbox_id");

-- CreateIndex
CREATE INDEX "cash_desk_transfers_organization_id_destination_cashbox_id_idx" ON "cash_desk_transfers"("organization_id", "destination_cashbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_transfers_tenant_id_number_key" ON "cash_desk_transfers"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "currency_denominations_tenant_id_currency_id_face_value_key" ON "currency_denominations"("tenant_id", "currency_id", "face_value");

-- CreateIndex
CREATE INDEX "cash_physical_counts_organization_id_cashbox_id_status_idx" ON "cash_physical_counts"("organization_id", "cashbox_id", "status");

-- CreateIndex
CREATE INDEX "cash_denomination_count_lines_tenant_id_count_id_idx" ON "cash_denomination_count_lines"("tenant_id", "count_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_count_adjustments_count_id_key" ON "cash_count_adjustments"("count_id");

-- CreateIndex
CREATE INDEX "cash_count_adjustments_organization_id_cashbox_id_idx" ON "cash_count_adjustments"("organization_id", "cashbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_count_adjustments_tenant_id_number_key" ON "cash_count_adjustments"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_daily_closes_physical_count_id_key" ON "cash_desk_daily_closes"("physical_count_id");

-- CreateIndex
CREATE INDEX "cash_desk_daily_closes_organization_id_cashbox_id_status_idx" ON "cash_desk_daily_closes"("organization_id", "cashbox_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_daily_closes_organization_id_cashbox_id_business__key" ON "cash_desk_daily_closes"("organization_id", "cashbox_id", "business_date");

-- CreateIndex
CREATE INDEX "cashier_handovers_organization_id_cashbox_id_status_idx" ON "cashier_handovers"("organization_id", "cashbox_id", "status");

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_assignments" ADD CONSTRAINT "cashier_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_assignments" ADD CONSTRAINT "cashier_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_assignments" ADD CONSTRAINT "cashier_assignments_cashbox_id_fkey" FOREIGN KEY ("cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_assignments" ADD CONSTRAINT "cashier_assignments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "responsible_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountable_person_movements" ADD CONSTRAINT "accountable_person_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountable_person_movements" ADD CONSTRAINT "accountable_person_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountable_person_movements" ADD CONSTRAINT "accountable_person_movements_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "responsible_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountable_person_movements" ADD CONSTRAINT "accountable_person_movements_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_transfers" ADD CONSTRAINT "cash_desk_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_transfers" ADD CONSTRAINT "cash_desk_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_transfers" ADD CONSTRAINT "cash_desk_transfers_source_cashbox_id_fkey" FOREIGN KEY ("source_cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_transfers" ADD CONSTRAINT "cash_desk_transfers_destination_cashbox_id_fkey" FOREIGN KEY ("destination_cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_transfers" ADD CONSTRAINT "cash_desk_transfers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_denominations" ADD CONSTRAINT "currency_denominations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_denominations" ADD CONSTRAINT "currency_denominations_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_physical_counts" ADD CONSTRAINT "cash_physical_counts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_physical_counts" ADD CONSTRAINT "cash_physical_counts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_physical_counts" ADD CONSTRAINT "cash_physical_counts_cashbox_id_fkey" FOREIGN KEY ("cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_physical_counts" ADD CONSTRAINT "cash_physical_counts_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_denomination_count_lines" ADD CONSTRAINT "cash_denomination_count_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_denomination_count_lines" ADD CONSTRAINT "cash_denomination_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "cash_physical_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_count_adjustments" ADD CONSTRAINT "cash_count_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_count_adjustments" ADD CONSTRAINT "cash_count_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_count_adjustments" ADD CONSTRAINT "cash_count_adjustments_cashbox_id_fkey" FOREIGN KEY ("cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_count_adjustments" ADD CONSTRAINT "cash_count_adjustments_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "cash_physical_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_count_adjustments" ADD CONSTRAINT "cash_count_adjustments_responsible_person_id_fkey" FOREIGN KEY ("responsible_person_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_daily_closes" ADD CONSTRAINT "cash_desk_daily_closes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_daily_closes" ADD CONSTRAINT "cash_desk_daily_closes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_daily_closes" ADD CONSTRAINT "cash_desk_daily_closes_cashbox_id_fkey" FOREIGN KEY ("cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_daily_closes" ADD CONSTRAINT "cash_desk_daily_closes_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_daily_closes" ADD CONSTRAINT "cash_desk_daily_closes_physical_count_id_fkey" FOREIGN KEY ("physical_count_id") REFERENCES "cash_physical_counts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_handovers" ADD CONSTRAINT "cashier_handovers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_handovers" ADD CONSTRAINT "cashier_handovers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_handovers" ADD CONSTRAINT "cashier_handovers_cashbox_id_fkey" FOREIGN KEY ("cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_handovers" ADD CONSTRAINT "cashier_handovers_outgoing_cashier_id_fkey" FOREIGN KEY ("outgoing_cashier_id") REFERENCES "responsible_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_handovers" ADD CONSTRAINT "cashier_handovers_incoming_cashier_id_fkey" FOREIGN KEY ("incoming_cashier_id") REFERENCES "responsible_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_handovers" ADD CONSTRAINT "cashier_handovers_denomination_count_id_fkey" FOREIGN KEY ("denomination_count_id") REFERENCES "cash_physical_counts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
