-- AlterTable
ALTER TABLE "counterparty_contract_lines" ADD COLUMN     "source_po_tax_amount" DECIMAL(18,2),
ADD COLUMN     "source_po_tax_rate_percent" DECIMAL(9,4),
ADD COLUMN     "tax_mismatch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "counterparty_contracts" ADD COLUMN     "lines_dirty" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "purchase_order_lines" ALTER COLUMN "price" DROP NOT NULL,
ALTER COLUMN "line_total" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

