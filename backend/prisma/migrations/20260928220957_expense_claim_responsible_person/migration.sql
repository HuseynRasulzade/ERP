-- AlterTable
ALTER TABLE "cost_centers" ALTER COLUMN "effective_from" SET DEFAULT '1970-01-01';

-- AlterTable
ALTER TABLE "expense_claims" ADD COLUMN     "responsible_person_id" TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';
