-- AlterTable
ALTER TABLE "counterparty_contracts" ADD COLUMN     "advance_amount" DECIMAL(18,2),
ADD COLUMN     "advance_amount_manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "advance_percent" DECIMAL(5,2),
ADD COLUMN     "delivery_address" TEXT,
ADD COLUMN     "delivery_date" DATE,
ADD COLUMN     "delivery_term_days" INTEGER,
ADD COLUMN     "delivery_terms" TEXT,
ADD COLUMN     "has_advance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "other_terms" TEXT,
ADD COLUMN     "penalty_terms" TEXT,
ADD COLUMN     "price_includes_tax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remaining_payable_amount" DECIMAL(18,2),
ADD COLUMN     "remaining_payment_due_days" INTEGER,
ADD COLUMN     "source_purchase_order_id" TEXT,
ADD COLUMN     "subtotal" DECIMAL(18,2),
ADD COLUMN     "total_discount" DECIMAL(18,2),
ADD COLUMN     "total_tax" DECIMAL(18,2),
ADD COLUMN     "warranty_period" TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "counterparty_contract_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "discount_percent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_base" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_category_code" TEXT,
    "tax_rate_percent" DECIMAL(9,4),
    "tax_amount" DECIMAL(18,2),
    "line_total" DECIMAL(18,2),
    "tax_calculation_error" TEXT,
    "source_order_line_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "counterparty_contract_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_contract_payment_installments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'AFTER_DELIVERY',
    "percentage" DECIMAL(9,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counterparty_contract_payment_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counterparty_contract_lines_contract_id_position_idx" ON "counterparty_contract_lines"("contract_id", "position");

-- CreateIndex
CREATE INDEX "counterparty_contract_lines_tenant_id_source_order_line_id_idx" ON "counterparty_contract_lines"("tenant_id", "source_order_line_id");

-- CreateIndex
CREATE INDEX "counterparty_contract_payment_installments_contract_id_sequ_idx" ON "counterparty_contract_payment_installments"("contract_id", "sequence");

-- CreateIndex
CREATE INDEX "counterparty_contracts_source_purchase_order_id_idx" ON "counterparty_contracts"("source_purchase_order_id");

-- AddForeignKey
ALTER TABLE "counterparty_contract_lines" ADD CONSTRAINT "counterparty_contract_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_lines" ADD CONSTRAINT "counterparty_contract_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "counterparty_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_lines" ADD CONSTRAINT "counterparty_contract_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_lines" ADD CONSTRAINT "counterparty_contract_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_payment_installments" ADD CONSTRAINT "counterparty_contract_payment_installments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_payment_installments" ADD CONSTRAINT "counterparty_contract_payment_installments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "counterparty_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contract_payment_installments" ADD CONSTRAINT "counterparty_contract_payment_installments_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

