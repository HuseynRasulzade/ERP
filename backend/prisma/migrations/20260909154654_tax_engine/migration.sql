-- CreateEnum
CREATE TYPE "TaxRateType" AS ENUM ('STANDARD', 'ZERO', 'EXEMPT', 'OUT_OF_SCOPE', 'SPECIAL');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD_RATE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE', 'SPECIAL_RATE');

-- CreateEnum
CREATE TYPE "TaxRuleStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'ACTIVE', 'FUTURE_EFFECTIVE', 'EXPIRED', 'REPEALED', 'SUPERSEDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TaxMovementDirection" AS ENUM ('OUTPUT', 'INPUT');

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "tax_legal_sources" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AZ',
    "sourceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "law_number" TEXT,
    "adoption_date" DATE,
    "publication_date" DATE,
    "effective_from" DATE,
    "effective_to" DATE,
    "source_version" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_legal_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tax_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tax_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "tax_type_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "tax_type_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AZ',
    "code" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "rate_type" "TaxRateType" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "legal_source_id" TEXT,
    "legal_article_reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "system_defined" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "localization_code" TEXT NOT NULL DEFAULT 'AZ_TAX',
    "tax_type_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rule_category" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "TaxRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "legal_source_id" TEXT,
    "legal_article_reference" TEXT,
    "legal_subarticle_reference" TEXT,
    "calculation_method" TEXT NOT NULL DEFAULT 'PERCENTAGE_OF_BASE',
    "rate_id" TEXT,
    "treatment" "TaxTreatment" NOT NULL,
    "exemption_code" TEXT,
    "condition_operation_type" TEXT,
    "condition_tax_category_code" TEXT,
    "condition_taxpayer_side" TEXT,
    "system_defined" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_exemptions" (
    "id" TEXT NOT NULL,
    "tax_type_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "legal_source_id" TEXT,
    "article_reference" TEXT,
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "tax_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_registrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tax_type" TEXT NOT NULL,
    "registration_number" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AZ',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "legal_basis" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tax_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tax_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "tax_category_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AZ',
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_tax_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "residency" TEXT NOT NULL DEFAULT 'RESIDENT',
    "vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "vat_registered_from" DATE,
    "special_tax_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparty_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tax_type" TEXT NOT NULL,
    "tax_code" TEXT,
    "tax_treatment" "TaxTreatment" NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "source_line_id" TEXT,
    "tax_point_date" DATE NOT NULL,
    "reporting_period" TEXT NOT NULL,
    "taxable_base" DECIMAL(20,4) NOT NULL,
    "tax_amount" DECIMAL(20,4) NOT NULL,
    "recoverable_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "nonrecoverable_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currency_id" TEXT,
    "base_currency_amount" DECIMAL(20,4),
    "direction" "TaxMovementDirection" NOT NULL,
    "tax_rule_id" TEXT NOT NULL,
    "tax_rate_id" TEXT,
    "posting_generation" INTEGER NOT NULL DEFAULT 1,
    "journal_entry_id" TEXT,
    "reversal_of_movement_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_types_code_key" ON "tax_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_categories_code_key" ON "tax_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_tax_type_id_code_key" ON "tax_codes"("tax_type_id", "code");

-- CreateIndex
CREATE INDEX "tax_rates_tax_type_id_jurisdiction_effective_from_idx" ON "tax_rates"("tax_type_id", "jurisdiction", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_tax_type_id_jurisdiction_code_effective_from_key" ON "tax_rates"("tax_type_id", "jurisdiction", "code", "effective_from");

-- CreateIndex
CREATE INDEX "tax_rules_tax_type_id_localization_code_effective_from_idx" ON "tax_rules"("tax_type_id", "localization_code", "effective_from");

-- CreateIndex
CREATE INDEX "tax_rules_tenant_id_idx" ON "tax_rules"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_exemptions_tax_type_id_code_key" ON "tax_exemptions"("tax_type_id", "code");

-- CreateIndex
CREATE INDEX "tax_registrations_tenant_id_organization_id_tax_type_valid__idx" ON "tax_registrations"("tenant_id", "organization_id", "tax_type", "valid_from");

-- CreateIndex
CREATE INDEX "product_tax_profiles_product_id_valid_from_idx" ON "product_tax_profiles"("product_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_tax_profiles_counterparty_id_key" ON "counterparty_tax_profiles"("counterparty_id");

-- CreateIndex
CREATE INDEX "tax_movements_tenant_id_organization_id_tax_point_date_idx" ON "tax_movements"("tenant_id", "organization_id", "tax_point_date");

-- CreateIndex
CREATE INDEX "tax_movements_organization_id_tax_type_reporting_period_idx" ON "tax_movements"("organization_id", "tax_type", "reporting_period");

-- CreateIndex
CREATE INDEX "tax_movements_tenant_id_source_document_type_source_documen_idx" ON "tax_movements"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "tax_movements_tax_rule_id_idx" ON "tax_movements"("tax_rule_id");

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_tax_type_id_fkey" FOREIGN KEY ("tax_type_id") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_type_id_fkey" FOREIGN KEY ("tax_type_id") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_legal_source_id_fkey" FOREIGN KEY ("legal_source_id") REFERENCES "tax_legal_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_tax_type_id_fkey" FOREIGN KEY ("tax_type_id") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_legal_source_id_fkey" FOREIGN KEY ("legal_source_id") REFERENCES "tax_legal_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_tax_type_id_fkey" FOREIGN KEY ("tax_type_id") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tax_profiles" ADD CONSTRAINT "product_tax_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tax_profiles" ADD CONSTRAINT "product_tax_profiles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tax_profiles" ADD CONSTRAINT "product_tax_profiles_tax_category_id_fkey" FOREIGN KEY ("tax_category_id") REFERENCES "tax_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tax_profiles" ADD CONSTRAINT "product_tax_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_tax_profiles" ADD CONSTRAINT "counterparty_tax_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_tax_profiles" ADD CONSTRAINT "counterparty_tax_profiles_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_movements" ADD CONSTRAINT "tax_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_movements" ADD CONSTRAINT "tax_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
