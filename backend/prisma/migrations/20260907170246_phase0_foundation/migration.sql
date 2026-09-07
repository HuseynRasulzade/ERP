-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED', 'INVITED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('SYSTEM', 'TENANT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED', 'DELETION_MARKED');

-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('NOT_POSTED', 'POSTED', 'POSTING_FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "base_currency_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Baku',
    "locale" TEXT NOT NULL DEFAULT 'az-AZ',
    "default_language" TEXT NOT NULL DEFAULT 'az',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" TEXT NOT NULL DEFAULT 'az-AZ',
    "timezone" TEXT,
    "is_system_admin" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "membership_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateTable
CREATE TABLE "enum_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "enum_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enum_values" (
    "id" TEXT NOT NULL,
    "enum_type_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "enum_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enum_value_translations" (
    "id" TEXT NOT NULL,
    "enum_value_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "enum_value_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "numeric_code" TEXT,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "currency_id" TEXT NOT NULL,
    "base_currency_id" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "multiplier" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "divisor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "rate_type" TEXT NOT NULL DEFAULT 'OFFICIAL',
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT DEFAULT '',
    "next_number" BIGINT NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "reset_policy" TEXT NOT NULL DEFAULT 'NEVER',
    "scope_type" TEXT NOT NULL DEFAULT 'TENANT_DOCUMENT_TYPE',
    "current_year" INTEGER,
    "current_month" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopened_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT,
    "correlation_id" TEXT,
    "ip_address" TEXT,
    "client_metadata" JSONB,
    "old_values" JSONB,
    "new_values" JSONB,
    "metadata" JSONB,
    "reason" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "target_document_type" TEXT NOT NULL,
    "target_document_id" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "metadata" JSONB,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "scope" "SettingScope" NOT NULL,
    "scope_id" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valid_from" DATE NOT NULL DEFAULT '1970-01-01',
    "valid_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "result_ref" TEXT,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "register_movements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "register_code" TEXT NOT NULL,
    "recorder_document_type" TEXT NOT NULL,
    "recorder_document_id" TEXT NOT NULL,
    "recorder_line_id" TEXT,
    "business_date" DATE NOT NULL,
    "posting_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" BIGINT NOT NULL,
    "movement_type" TEXT,
    "dimensions" JSONB,
    "resources" JSONB,

    CONSTRAINT "register_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foundation_test_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "document_type" TEXT NOT NULL DEFAULT 'FOUNDATION_TEST_DOCUMENT',
    "number" TEXT,
    "document_date" DATE NOT NULL,
    "posting_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "currency_id" TEXT,
    "exchange_rate" DECIMAL(24,10),
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "deletion_mark" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "foundation_test_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TenantCurrencies" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "organizations_tenant_id_idx" ON "organizations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_tenant_id_code_key" ON "organizations"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "enum_types_code_key" ON "enum_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "enum_values_enum_type_id_code_key" ON "enum_values"("enum_type_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "enum_value_translations_enum_value_id_locale_key" ON "enum_value_translations"("enum_value_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE INDEX "exchange_rates_tenant_id_currency_id_effective_date_idx" ON "exchange_rates"("tenant_id", "currency_id", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_exchange_rate_scope" ON "exchange_rates"("tenant_id", "currency_id", "base_currency_id", "effective_date", "rate_type");

-- CreateIndex
CREATE INDEX "number_sequences_tenant_id_document_type_idx" ON "number_sequences"("tenant_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_tenant_id_code_key" ON "number_sequences"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "accounting_periods_tenant_id_start_date_end_date_idx" ON "accounting_periods"("tenant_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_tenant_id_organization_id_year_month_key" ON "accounting_periods"("tenant_id", "organization_id", "year", "month");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_entity_type_entity_id_idx" ON "audit_events"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_timestamp_idx" ON "audit_events"("tenant_id", "timestamp");

-- CreateIndex
CREATE INDEX "document_links_tenant_id_source_document_type_source_docume_idx" ON "document_links"("tenant_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "document_links_tenant_id_target_document_type_target_docume_idx" ON "document_links"("tenant_id", "target_document_type", "target_document_id");

-- CreateIndex
CREATE INDEX "settings_scope_scope_id_key_valid_from_idx" ON "settings"("scope", "scope_id", "key", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_key_operation_key" ON "idempotency_keys"("tenant_id", "key", "operation");

-- CreateIndex
CREATE INDEX "register_movements_tenant_id_recorder_document_type_recorde_idx" ON "register_movements"("tenant_id", "recorder_document_type", "recorder_document_id");

-- CreateIndex
CREATE INDEX "register_movements_tenant_id_register_code_business_date_idx" ON "register_movements"("tenant_id", "register_code", "business_date");

-- CreateIndex
CREATE INDEX "foundation_test_documents_tenant_id_document_date_idx" ON "foundation_test_documents"("tenant_id", "document_date");

-- CreateIndex
CREATE INDEX "foundation_test_documents_tenant_id_status_idx" ON "foundation_test_documents"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "foundation_test_documents_tenant_id_number_key" ON "foundation_test_documents"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "_TenantCurrencies_AB_unique" ON "_TenantCurrencies"("A", "B");

-- CreateIndex
CREATE INDEX "_TenantCurrencies_B_index" ON "_TenantCurrencies"("B");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enum_values" ADD CONSTRAINT "enum_values_enum_type_id_fkey" FOREIGN KEY ("enum_type_id") REFERENCES "enum_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enum_value_translations" ADD CONSTRAINT "enum_value_translations_enum_value_id_fkey" FOREIGN KEY ("enum_value_id") REFERENCES "enum_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_scope_fkey" FOREIGN KEY ("scope_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_movements" ADD CONSTRAINT "register_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foundation_test_documents" ADD CONSTRAINT "foundation_test_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TenantCurrencies" ADD CONSTRAINT "_TenantCurrencies_A_fkey" FOREIGN KEY ("A") REFERENCES "currencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TenantCurrencies" ADD CONSTRAINT "_TenantCurrencies_B_fkey" FOREIGN KEY ("B") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
