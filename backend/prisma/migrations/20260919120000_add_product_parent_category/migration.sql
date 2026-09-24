-- CreateTable
CREATE TABLE "product_parent_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_parent_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_catalog_code_counters" (
    "organization_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "next_number" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "product_catalog_code_counters_pkey" PRIMARY KEY ("organization_id","entity_type")
);

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN "parent_group_id" TEXT;

-- CreateIndex
CREATE INDEX "product_parent_categories_organization_id_active_idx" ON "product_parent_categories"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "product_parent_categories_organization_id_code_key" ON "product_parent_categories"("organization_id", "code");

-- CreateIndex
CREATE INDEX "product_categories_organization_id_parent_group_id_idx" ON "product_categories"("organization_id", "parent_group_id");

-- AddForeignKey
ALTER TABLE "product_parent_categories" ADD CONSTRAINT "product_parent_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_parent_categories" ADD CONSTRAINT "product_parent_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_group_id_fkey" FOREIGN KEY ("parent_group_id") REFERENCES "product_parent_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
