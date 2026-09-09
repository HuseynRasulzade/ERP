-- CreateEnum
CREATE TYPE "AccountClass" AS ENUM ('ASSET', 'CONTRA_ASSET', 'LIABILITY', 'CONTRA_LIABILITY', 'EQUITY', 'CONTRA_EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE', 'PROFIT_LOSS', 'TAX_EXPENSE', 'OFF_BALANCE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT', 'BOTH');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "EntrySide" AS ENUM ('DEBIT', 'CREDIT');

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "charts_of_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL DEFAULT 'AZ',
    "localization_code" TEXT NOT NULL DEFAULT 'AZ_STANDARD_COA',
    "version_code" TEXT NOT NULL DEFAULT '1.0',
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "system_template" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organizationId" TEXT,

    CONSTRAINT "charts_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_statement_sections" (
    "id" TEXT NOT NULL,
    "chart_of_accounts_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "statement_type" TEXT NOT NULL DEFAULT 'BALANCE_SHEET',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "financial_statement_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_statement_groups" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "financial_statement_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "chart_of_accounts_id" TEXT NOT NULL,
    "parent_account_id" TEXT,
    "financial_statement_section_id" TEXT,
    "financial_statement_group_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "account_class" "AccountClass" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "posting_allowed" BOOLEAN NOT NULL DEFAULT true,
    "off_balance" BOOLEAN NOT NULL DEFAULT false,
    "currency_tracking" BOOLEAN NOT NULL DEFAULT false,
    "quantity_tracking" BOOLEAN NOT NULL DEFAULT false,
    "system_account" BOOLEAN NOT NULL DEFAULT false,
    "customizable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "source_template" TEXT DEFAULT 'AZ_STANDARD_COA',
    "template_version" TEXT,
    "system_seed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_dimension_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value_type" TEXT NOT NULL DEFAULT 'REFERENCE',
    "reference_entity_type" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "system_defined" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_dimension_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_dimension_rules" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "dimension_definition_id" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "balance_tracking" BOOLEAN NOT NULL DEFAULT true,
    "turnover_tracking" BOOLEAN NOT NULL DEFAULT true,
    "quantity_tracking" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "account_dimension_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "mapping_key" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounting_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "journal_number" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "posting_date" DATE NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "operation_type" TEXT NOT NULL DEFAULT 'MANUAL',
    "generated_by" TEXT NOT NULL DEFAULT 'MANUAL_OPERATION',
    "description" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "is_manual" BOOLEAN NOT NULL DEFAULT true,
    "is_opening_balance" BOOLEAN NOT NULL DEFAULT false,
    "is_reversal" BOOLEAN NOT NULL DEFAULT false,
    "reversal_of_entry_id" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "account_id" TEXT NOT NULL,
    "side" "EntrySide" NOT NULL,
    "amount_base" DECIMAL(20,4) NOT NULL,
    "transaction_currency_id" TEXT,
    "amount_transaction" DECIMAL(20,4),
    "exchange_rate" DECIMAL(20,10),
    "quantity" DECIMAL(20,6),
    "quantity_unit_id" TEXT,
    "description" TEXT,
    "source_document_line_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_line_dimensions" (
    "id" TEXT NOT NULL,
    "journal_line_id" TEXT NOT NULL,
    "dimension_definition_id" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "scalar_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_line_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "journal_line_id" TEXT NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "source_document_line_id" TEXT,
    "account_id" TEXT NOT NULL,
    "side" "EntrySide" NOT NULL,
    "business_date" DATE NOT NULL,
    "posting_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posting_sequence" BIGINT NOT NULL,
    "amount_base" DECIMAL(20,4) NOT NULL,
    "transaction_currency_id" TEXT,
    "amount_transaction" DECIMAL(20,4),
    "exchange_rate" DECIMAL(20,10),
    "quantity" DECIMAL(20,6),
    "quantity_unit_id" TEXT,
    "reversal_of_movement_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_movement_dimensions" (
    "id" TEXT NOT NULL,
    "accounting_movement_id" TEXT NOT NULL,
    "dimension_definition_id" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "scalar_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_movement_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "actor" TEXT,
    "correlation_id" TEXT,
    "failure_code" TEXT,

    CONSTRAINT "posting_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "charts_of_accounts_tenant_id_idx" ON "charts_of_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "charts_of_accounts_tenant_id_code_key" ON "charts_of_accounts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "financial_statement_sections_chart_of_accounts_id_code_key" ON "financial_statement_sections"("chart_of_accounts_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "financial_statement_groups_section_id_code_key" ON "financial_statement_groups"("section_id", "code");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_active_idx" ON "accounts"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_parent_account_id_idx" ON "accounts"("tenant_id", "parent_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_chart_of_accounts_id_code_key" ON "accounts"("tenant_id", "chart_of_accounts_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_dimension_definitions_tenant_id_code_key" ON "accounting_dimension_definitions"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "account_dimension_rules_account_id_dimension_definition_id__key" ON "account_dimension_rules"("account_id", "dimension_definition_id", "valid_from");

-- CreateIndex
CREATE INDEX "accounting_mappings_tenant_id_organization_id_mapping_key_v_idx" ON "accounting_mappings"("tenant_id", "organization_id", "mapping_key", "valid_from");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_organization_id_business_date_idx" ON "journal_entries"("tenant_id", "organization_id", "business_date");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_source_document_type_source_docum_idx" ON "journal_entries"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenant_id_journal_number_key" ON "journal_entries"("tenant_id", "journal_number");

-- CreateIndex
CREATE INDEX "journal_entry_lines_journal_entry_id_sequence_idx" ON "journal_entry_lines"("journal_entry_id", "sequence");

-- CreateIndex
CREATE INDEX "journal_entry_lines_account_id_idx" ON "journal_entry_lines"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_line_dimensions_journal_line_id_dimension_definitio_key" ON "journal_line_dimensions"("journal_line_id", "dimension_definition_id");

-- CreateIndex
CREATE INDEX "accounting_movements_tenant_id_organization_id_business_dat_idx" ON "accounting_movements"("tenant_id", "organization_id", "business_date");

-- CreateIndex
CREATE INDEX "accounting_movements_organization_id_account_id_business_da_idx" ON "accounting_movements"("organization_id", "account_id", "business_date");

-- CreateIndex
CREATE INDEX "accounting_movements_journal_entry_id_idx" ON "accounting_movements"("journal_entry_id");

-- CreateIndex
CREATE INDEX "accounting_movements_tenant_id_source_document_type_source__idx" ON "accounting_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "accounting_movements_account_id_business_date_idx" ON "accounting_movements"("account_id", "business_date");

-- CreateIndex
CREATE INDEX "accounting_movement_dimensions_dimension_definition_id_refe_idx" ON "accounting_movement_dimensions"("dimension_definition_id", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_movement_dimensions_accounting_movement_id_dimen_key" ON "accounting_movement_dimensions"("accounting_movement_id", "dimension_definition_id");

-- CreateIndex
CREATE INDEX "posting_runs_tenant_id_source_document_type_source_document_idx" ON "posting_runs"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "posting_runs_tenant_id_source_document_type_source_document_key" ON "posting_runs"("tenant_id", "source_document_type", "source_document_id", "generation");

-- AddForeignKey
ALTER TABLE "charts_of_accounts" ADD CONSTRAINT "charts_of_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charts_of_accounts" ADD CONSTRAINT "charts_of_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_sections" ADD CONSTRAINT "financial_statement_sections_chart_of_accounts_id_fkey" FOREIGN KEY ("chart_of_accounts_id") REFERENCES "charts_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_groups" ADD CONSTRAINT "financial_statement_groups_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "financial_statement_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_chart_of_accounts_id_fkey" FOREIGN KEY ("chart_of_accounts_id") REFERENCES "charts_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_financial_statement_section_id_fkey" FOREIGN KEY ("financial_statement_section_id") REFERENCES "financial_statement_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_financial_statement_group_id_fkey" FOREIGN KEY ("financial_statement_group_id") REFERENCES "financial_statement_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_dimension_definitions" ADD CONSTRAINT "accounting_dimension_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_dimension_rules" ADD CONSTRAINT "account_dimension_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_dimension_rules" ADD CONSTRAINT "account_dimension_rules_dimension_definition_id_fkey" FOREIGN KEY ("dimension_definition_id") REFERENCES "accounting_dimension_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mappings" ADD CONSTRAINT "accounting_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mappings" ADD CONSTRAINT "accounting_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_mappings" ADD CONSTRAINT "accounting_mappings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_entry_id_fkey" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_transaction_currency_id_fkey" FOREIGN KEY ("transaction_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_quantity_unit_id_fkey" FOREIGN KEY ("quantity_unit_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_entry_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_dimension_definition_id_fkey" FOREIGN KEY ("dimension_definition_id") REFERENCES "accounting_dimension_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movements" ADD CONSTRAINT "accounting_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movements" ADD CONSTRAINT "accounting_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movements" ADD CONSTRAINT "accounting_movements_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movements" ADD CONSTRAINT "accounting_movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movements" ADD CONSTRAINT "accounting_movements_transaction_currency_id_fkey" FOREIGN KEY ("transaction_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movements" ADD CONSTRAINT "accounting_movements_quantity_unit_id_fkey" FOREIGN KEY ("quantity_unit_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movements" ADD CONSTRAINT "accounting_movements_reversal_of_movement_id_fkey" FOREIGN KEY ("reversal_of_movement_id") REFERENCES "accounting_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movement_dimensions" ADD CONSTRAINT "accounting_movement_dimensions_accounting_movement_id_fkey" FOREIGN KEY ("accounting_movement_id") REFERENCES "accounting_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_movement_dimensions" ADD CONSTRAINT "accounting_movement_dimensions_dimension_definition_id_fkey" FOREIGN KEY ("dimension_definition_id") REFERENCES "accounting_dimension_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_runs" ADD CONSTRAINT "posting_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_runs" ADD CONSTRAINT "posting_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
