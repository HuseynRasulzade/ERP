/*
  Warnings:

  - Added the required column `updated_at` to the `organizations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "actual_address" TEXT,
ADD COLUMN     "base_currency_id" TEXT,
ADD COLUMN     "country_code" TEXT NOT NULL DEFAULT 'AZ',
ADD COLUMN     "default_bank_account_id" TEXT,
ADD COLUMN     "default_branch_id" TEXT,
ADD COLUMN     "default_cashbox_id" TEXT,
ADD COLUMN     "default_language" TEXT NOT NULL DEFAULT 'az',
ADD COLUMN     "default_warehouse_id" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "full_legal_name" TEXT,
ADD COLUMN     "legal_form" TEXT,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'az-AZ',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "registered_address" TEXT,
ADD COLUMN     "registration_number" TEXT,
ADD COLUMN     "short_name" TEXT,
ADD COLUMN     "tax_id" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Baku',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updated_by" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "manager_person_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "parent_department_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manager_person_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responsible_persons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "responsible_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "warehouse_type" TEXT NOT NULL DEFAULT 'STANDARD',
    "address" TEXT,
    "responsible_person_id" TEXT,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashboxes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency_id" TEXT NOT NULL,
    "responsible_person_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cashboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "bank_code" TEXT,
    "branch_name" TEXT,
    "account_name" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "swift_bic" TEXT,
    "currency_id" TEXT NOT NULL,
    "correspondent_account" TEXT,
    "account_type" TEXT NOT NULL DEFAULT 'CURRENT',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "opened_date" DATE,
    "closed_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "inventory_costing_method" TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "base_currency_id" TEXT,
    "tax_profile_id" TEXT,
    "settings" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounting_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL DEFAULT 'AZ',
    "tax_id" TEXT,
    "vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "vat_registration_date" DATE,
    "vat_deregistration_date" DATE,
    "tax_regime_code" TEXT,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_access" (
    "id" TEXT NOT NULL,
    "tenant_membership_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "access_level" TEXT NOT NULL DEFAULT 'FULL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "organization_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_organization_id_active_idx" ON "branches"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");

-- CreateIndex
CREATE INDEX "departments_organization_id_parent_department_id_idx" ON "departments"("organization_id", "parent_department_id");

-- CreateIndex
CREATE INDEX "departments_organization_id_active_idx" ON "departments"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE INDEX "responsible_persons_tenant_id_active_idx" ON "responsible_persons"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "warehouses_organization_id_active_idx" ON "warehouses"("organization_id", "active");

-- CreateIndex
CREATE INDEX "warehouses_organization_id_branch_id_idx" ON "warehouses"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_code_key" ON "warehouses"("organization_id", "code");

-- CreateIndex
CREATE INDEX "cashboxes_organization_id_active_idx" ON "cashboxes"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "cashboxes_organization_id_code_key" ON "cashboxes"("organization_id", "code");

-- CreateIndex
CREATE INDEX "bank_accounts_organization_id_active_idx" ON "bank_accounts"("organization_id", "active");

-- CreateIndex
CREATE INDEX "bank_accounts_iban_idx" ON "bank_accounts"("iban");

-- CreateIndex
CREATE INDEX "accounting_policies_organization_id_valid_from_valid_to_idx" ON "accounting_policies"("organization_id", "valid_from", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_policies_organization_id_code_valid_from_key" ON "accounting_policies"("organization_id", "code", "valid_from");

-- CreateIndex
CREATE INDEX "tax_profiles_organization_id_valid_from_valid_to_idx" ON "tax_profiles"("organization_id", "valid_from", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_organization_id_code_valid_from_key" ON "tax_profiles"("organization_id", "code", "valid_from");

-- CreateIndex
CREATE INDEX "organization_access_organization_id_idx" ON "organization_access"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_access_tenant_membership_id_organization_id_key" ON "organization_access"("tenant_membership_id", "organization_id");

-- CreateIndex
CREATE INDEX "organizations_tenant_id_active_idx" ON "organizations"("tenant_id", "active");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_branch_id_fkey" FOREIGN KEY ("default_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_warehouse_id_fkey" FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_cashbox_id_fkey" FOREIGN KEY ("default_cashbox_id") REFERENCES "cashboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_bank_account_id_fkey" FOREIGN KEY ("default_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_manager_person_id_fkey" FOREIGN KEY ("manager_person_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_department_id_fkey" FOREIGN KEY ("parent_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_person_id_fkey" FOREIGN KEY ("manager_person_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsible_persons" ADD CONSTRAINT "responsible_persons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsible_persons" ADD CONSTRAINT "responsible_persons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_responsible_person_id_fkey" FOREIGN KEY ("responsible_person_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_responsible_person_id_fkey" FOREIGN KEY ("responsible_person_id") REFERENCES "responsible_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_policies" ADD CONSTRAINT "accounting_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_policies" ADD CONSTRAINT "accounting_policies_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_policies" ADD CONSTRAINT "accounting_policies_tax_profile_id_fkey" FOREIGN KEY ("tax_profile_id") REFERENCES "tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_access" ADD CONSTRAINT "organization_access_tenant_membership_id_fkey" FOREIGN KEY ("tenant_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_access" ADD CONSTRAINT "organization_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
