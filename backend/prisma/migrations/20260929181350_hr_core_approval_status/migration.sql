-- AlterTable
ALTER TABLE "hr_employee_transfers" ADD COLUMN     "approval_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "hr_hire_documents" ADD COLUMN     "approval_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "hr_termination_documents" ADD COLUMN     "approval_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
