-- AlterTable
ALTER TABLE "organization_access" ADD COLUMN     "department_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_requirements" ADD COLUMN     "created_by_name" TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- AddForeignKey
ALTER TABLE "organization_access" ADD CONSTRAINT "organization_access_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

