-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "overdraft_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overdraft_limit" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "approved_amount" DECIMAL(18,2),
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'SUPPLIER',
ADD COLUMN     "planned_amount" DECIMAL(18,2),
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "requested_payment_date" DATE;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "incoming_bank_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'INCOMING_BANK_PAYMENT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "bank_account_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CUSTOMER_PAYMENT',
    "counterparty_id" TEXT,
    "currency_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "bank_reference" TEXT,
    "source_sales_invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "incoming_bank_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_bank_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'INTERNAL_BANK_TRANSFER',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "source_bank_account_id" TEXT NOT NULL,
    "destination_bank_account_id" TEXT NOT NULL,
    "currency_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transfer_state" TEXT NOT NULL DEFAULT 'COMPLETED',
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

    CONSTRAINT "internal_bank_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_fees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'BANK_FEE',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "bank_account_id" TEXT NOT NULL,
    "fee_type" TEXT NOT NULL DEFAULT 'OTHER',
    "currency_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "source_statement_line_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bank_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_conversions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'FX_CONVERSION',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "source_bank_account_id" TEXT NOT NULL,
    "destination_bank_account_id" TEXT NOT NULL,
    "source_currency_id" TEXT NOT NULL,
    "source_amount" DECIMAL(18,2) NOT NULL,
    "destination_currency_id" TEXT NOT NULL,
    "destination_amount" DECIMAL(18,2) NOT NULL,
    "trade_rate" DECIMAL(24,10) NOT NULL,
    "official_rate" DECIMAL(24,10),
    "bank_fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
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

    CONSTRAINT "fx_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "book_opening_balance" DECIMAL(18,2) NOT NULL,
    "bank_opening_balance" DECIMAL(18,2) NOT NULL,
    "book_closing_balance" DECIMAL(18,2),
    "bank_closing_balance" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
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

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_payment_approval_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "category" TEXT,
    "min_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "max_amount" DECIMAL(18,2),
    "step_type" "ApprovalStepType" NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "treasury_payment_approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_liquidity_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bank_account_id" TEXT,
    "currency_id" TEXT,
    "minimum_balance" DECIMAL(18,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "treasury_liquidity_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incoming_bank_payments_organization_id_bank_account_id_stat_idx" ON "incoming_bank_payments"("organization_id", "bank_account_id", "status");

-- CreateIndex
CREATE INDEX "incoming_bank_payments_organization_id_counterparty_id_idx" ON "incoming_bank_payments"("organization_id", "counterparty_id");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_bank_payments_tenant_id_number_key" ON "incoming_bank_payments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "internal_bank_transfers_organization_id_source_bank_account_idx" ON "internal_bank_transfers"("organization_id", "source_bank_account_id");

-- CreateIndex
CREATE INDEX "internal_bank_transfers_organization_id_destination_bank_ac_idx" ON "internal_bank_transfers"("organization_id", "destination_bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_bank_transfers_tenant_id_number_key" ON "internal_bank_transfers"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "bank_fees_source_statement_line_id_key" ON "bank_fees"("source_statement_line_id");

-- CreateIndex
CREATE INDEX "bank_fees_organization_id_bank_account_id_idx" ON "bank_fees"("organization_id", "bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_fees_tenant_id_number_key" ON "bank_fees"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "fx_conversions_organization_id_source_bank_account_id_idx" ON "fx_conversions"("organization_id", "source_bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_conversions_tenant_id_number_key" ON "fx_conversions"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "bank_reconciliations_organization_id_bank_account_id_status_idx" ON "bank_reconciliations"("organization_id", "bank_account_id", "status");

-- CreateIndex
CREATE INDEX "treasury_payment_approval_rules_tenant_id_organization_id_c_idx" ON "treasury_payment_approval_rules"("tenant_id", "organization_id", "category", "active");

-- CreateIndex
CREATE INDEX "treasury_liquidity_policies_organization_id_bank_account_id_idx" ON "treasury_liquidity_policies"("organization_id", "bank_account_id", "currency_id");

-- AddForeignKey
ALTER TABLE "incoming_bank_payments" ADD CONSTRAINT "incoming_bank_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_bank_payments" ADD CONSTRAINT "incoming_bank_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_bank_payments" ADD CONSTRAINT "incoming_bank_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_bank_payments" ADD CONSTRAINT "incoming_bank_payments_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_bank_payments" ADD CONSTRAINT "incoming_bank_payments_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_bank_payments" ADD CONSTRAINT "incoming_bank_payments_source_sales_invoice_id_fkey" FOREIGN KEY ("source_sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_bank_transfers" ADD CONSTRAINT "internal_bank_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_bank_transfers" ADD CONSTRAINT "internal_bank_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_bank_transfers" ADD CONSTRAINT "internal_bank_transfers_source_bank_account_id_fkey" FOREIGN KEY ("source_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_bank_transfers" ADD CONSTRAINT "internal_bank_transfers_destination_bank_account_id_fkey" FOREIGN KEY ("destination_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_bank_transfers" ADD CONSTRAINT "internal_bank_transfers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_fees" ADD CONSTRAINT "bank_fees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_fees" ADD CONSTRAINT "bank_fees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_fees" ADD CONSTRAINT "bank_fees_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_fees" ADD CONSTRAINT "bank_fees_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_fees" ADD CONSTRAINT "bank_fees_source_statement_line_id_fkey" FOREIGN KEY ("source_statement_line_id") REFERENCES "bank_statement_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_source_bank_account_id_fkey" FOREIGN KEY ("source_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_destination_bank_account_id_fkey" FOREIGN KEY ("destination_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_source_currency_id_fkey" FOREIGN KEY ("source_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_conversions" ADD CONSTRAINT "fx_conversions_destination_currency_id_fkey" FOREIGN KEY ("destination_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payment_approval_rules" ADD CONSTRAINT "treasury_payment_approval_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payment_approval_rules" ADD CONSTRAINT "treasury_payment_approval_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_liquidity_policies" ADD CONSTRAINT "treasury_liquidity_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_liquidity_policies" ADD CONSTRAINT "treasury_liquidity_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_liquidity_policies" ADD CONSTRAINT "treasury_liquidity_policies_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_liquidity_policies" ADD CONSTRAINT "treasury_liquidity_policies_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
