/*
  Warnings:

  - Added the required column `organization_id` to the `hr_employee_transfers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "hr_employee_transfers" ADD COLUMN     "organization_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateIndex
CREATE INDEX "hr_employee_transfers_organization_id_idx" ON "hr_employee_transfers"("organization_id");

-- AddForeignKey
ALTER TABLE "hr_employee_transfers" ADD CONSTRAINT "hr_employee_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
