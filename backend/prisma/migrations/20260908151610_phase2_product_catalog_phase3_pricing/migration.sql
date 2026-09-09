-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('GOODS', 'SERVICE', 'WORK', 'SET');

-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('LEGAL', 'SHIPPING', 'BILLING', 'OTHER');

-- CreateEnum
CREATE TYPE "PriceListType" AS ENUM ('SALE', 'PURCHASE');

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "unit_type" TEXT NOT NULL DEFAULT 'QUANTITY',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "parent_category_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT,
    "product_type" "ProductType" NOT NULL DEFAULT 'GOODS',
    "base_unit_id" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "manufacturer" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "weight" DECIMAL(18,6),
    "weight_unit_id" TEXT,
    "volume" DECIMAL(18,6),
    "volume_unit_id" TEXT,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_unit_id" TEXT NOT NULL,
    "to_unit_id" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "counterparty_type" "CounterpartyType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_legal_name" TEXT,
    "tax_id" TEXT,
    "registration_number" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "payment_terms" INTEGER,
    "credit_limit" DECIMAL(18,2),
    "currency_id" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_addresses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "address_type" "AddressType" NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "state_province" TEXT,
    "postal_code" TEXT,
    "country_code" TEXT NOT NULL DEFAULT 'AZ',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counterparty_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counterparty_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "price_list_type" "PriceListType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "counterparty_id" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "includes_tax" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "min_quantity" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "max_quantity" DECIMAL(18,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "units_of_measure_tenant_id_active_idx" ON "units_of_measure"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_tenant_id_code_key" ON "units_of_measure"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "product_categories_organization_id_active_idx" ON "product_categories"("organization_id", "active");

-- CreateIndex
CREATE INDEX "product_categories_organization_id_parent_category_id_idx" ON "product_categories"("organization_id", "parent_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_organization_id_code_key" ON "product_categories"("organization_id", "code");

-- CreateIndex
CREATE INDEX "products_organization_id_active_idx" ON "products"("organization_id", "active");

-- CreateIndex
CREATE INDEX "products_organization_id_category_id_idx" ON "products"("organization_id", "category_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_sku_idx" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "products_tenant_id_barcode_idx" ON "products"("tenant_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_code_key" ON "products"("organization_id", "code");

-- CreateIndex
CREATE INDEX "unit_conversions_tenant_id_active_idx" ON "unit_conversions"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "unit_conversions_tenant_id_from_unit_id_to_unit_id_key" ON "unit_conversions"("tenant_id", "from_unit_id", "to_unit_id");

-- CreateIndex
CREATE INDEX "counterparties_organization_id_active_idx" ON "counterparties"("organization_id", "active");

-- CreateIndex
CREATE INDEX "counterparties_organization_id_counterparty_type_idx" ON "counterparties"("organization_id", "counterparty_type");

-- CreateIndex
CREATE INDEX "counterparties_tenant_id_tax_id_idx" ON "counterparties"("tenant_id", "tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_organization_id_code_key" ON "counterparties"("organization_id", "code");

-- CreateIndex
CREATE INDEX "counterparty_addresses_counterparty_id_active_idx" ON "counterparty_addresses"("counterparty_id", "active");

-- CreateIndex
CREATE INDEX "counterparty_addresses_counterparty_id_is_default_idx" ON "counterparty_addresses"("counterparty_id", "is_default");

-- CreateIndex
CREATE INDEX "counterparty_contacts_counterparty_id_active_idx" ON "counterparty_contacts"("counterparty_id", "active");

-- CreateIndex
CREATE INDEX "counterparty_contacts_counterparty_id_is_primary_idx" ON "counterparty_contacts"("counterparty_id", "is_primary");

-- CreateIndex
CREATE INDEX "price_lists_organization_id_active_idx" ON "price_lists"("organization_id", "active");

-- CreateIndex
CREATE INDEX "price_lists_organization_id_price_list_type_valid_from_vali_idx" ON "price_lists"("organization_id", "price_list_type", "valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "price_lists_organization_id_counterparty_id_idx" ON "price_lists"("organization_id", "counterparty_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_organization_id_code_key" ON "price_lists"("organization_id", "code");

-- CreateIndex
CREATE INDEX "product_prices_price_list_id_active_idx" ON "product_prices"("price_list_id", "active");

-- CreateIndex
CREATE INDEX "product_prices_product_id_active_idx" ON "product_prices"("product_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_price_list_id_product_id_unit_id_min_quantit_key" ON "product_prices"("price_list_id", "product_id", "unit_id", "min_quantity");

-- AddForeignKey
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_category_id_fkey" FOREIGN KEY ("parent_category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_id_fkey" FOREIGN KEY ("to_unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_addresses" ADD CONSTRAINT "counterparty_addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_addresses" ADD CONSTRAINT "counterparty_addresses_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contacts" ADD CONSTRAINT "counterparty_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contacts" ADD CONSTRAINT "counterparty_contacts_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
