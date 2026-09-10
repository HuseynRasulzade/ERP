-- AlterTable
ALTER TABLE "sales_order_lines" ALTER COLUMN "reservation_policy" SET DEFAULT 'TRY_RESERVE';

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

