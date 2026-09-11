-- AlterEnum
ALTER TYPE "AddressType" ADD VALUE 'ACTUAL';

-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "country_code" TEXT,
ADD COLUMN     "foreign_tax_id" TEXT,
ADD COLUMN     "residency_status" TEXT NOT NULL DEFAULT 'RESIDENT',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "vat_payer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "counterparty_bank_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "bank_tax_id" TEXT,
    "bank_code" TEXT,
    "bank_address" TEXT,
    "account_number" TEXT NOT NULL,
    "iban" TEXT,
    "swift_bic" TEXT,
    "correspondent_account" TEXT,
    "currency_id" TEXT,
    "branch_name" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counterparty_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "contract_type" TEXT,
    "signed_date" DATE,
    "start_date" DATE,
    "end_date" DATE,
    "amount" DECIMAL(18,2),
    "currency_id" TEXT,
    "payment_terms" TEXT,
    "responsible_person_id" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counterparty_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_contract_amendments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "amendment_date" DATE,
    "effective_date" DATE,
    "end_date" DATE,
    "new_amount" DECIMAL(18,2),
    "currency_id" TEXT,
    "change_description" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counterparty_contract_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "document_version" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counterparty_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counterparty_bank_accounts_counterparty_id_active_idx" ON "counterparty_bank_accounts"("counterparty_id", "active");

-- CreateIndex
CREATE INDEX "counterparty_bank_accounts_counterparty_id_is_primary_idx" ON "counterparty_bank_accounts"("counterparty_id", "is_primary");

-- CreateIndex
CREATE INDEX "counterparty_contracts_organization_id_status_idx" ON "counterparty_contracts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_contracts_counterparty_id_number_key" ON "counterparty_contracts"("counterparty_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_contract_amendments_contract_id_number_key" ON "counterparty_contract_amendments"("contract_id", "number");

-- CreateIndex
CREATE INDEX "counterparty_documents_tenant_id_owner_type_owner_id_active_idx" ON "counterparty_documents"("tenant_id", "owner_type", "owner_id", "active");

-- CreateIndex
CREATE INDEX "counterparties_organization_id_status_idx" ON "counterparties"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_organization_id_tax_id_key" ON "counterparties"("organization_id", "tax_id");

-- AddForeignKey
ALTER TABLE "counterparty_bank_accounts" ADD CONSTRAINT "counterparty_bank_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_bank_accounts" ADD CONSTRAINT "counterparty_bank_accounts_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_bank_accounts" ADD CONSTRAINT "counterparty_bank_accounts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contracts" ADD CONSTRAINT "counterparty_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contracts" ADD CONSTRAINT "counterparty_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contracts" ADD CONSTRAINT "counterparty_contracts_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contracts" ADD CONSTRAINT "counterparty_contracts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contracts" ADD CONSTRAINT "counterparty_contracts_responsible_person_id_fkey" FOREIGN KEY ("responsible_person_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_amendments" ADD CONSTRAINT "counterparty_contract_amendments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_amendments" ADD CONSTRAINT "counterparty_contract_amendments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "counterparty_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_amendments" ADD CONSTRAINT "counterparty_contract_amendments_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_documents" ADD CONSTRAINT "counterparty_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

