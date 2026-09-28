-- AlterTable
ALTER TABLE "fixed_asset_disposals" ADD COLUMN     "buyer_id" TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';
