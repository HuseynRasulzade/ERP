-- AlterTable
ALTER TABLE "counterparty_contacts" ADD COLUMN     "department" TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

