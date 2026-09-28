-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "hr_physical_persons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "full_name" TEXT NOT NULL,
    "gender" TEXT,
    "birth_date" DATE,
    "nationality" TEXT,
    "personal_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "emergency_contact" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_physical_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "physical_person_id" TEXT NOT NULL,
    "personnel_number" TEXT NOT NULL,
    "employee_code" TEXT,
    "default_organization_id" TEXT,
    "corporate_email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "hire_first_date" DATE,
    "last_termination_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "employment_start_date" DATE NOT NULL,
    "employment_end_date" DATE,
    "primary_employment" BOOLEAN NOT NULL DEFAULT true,
    "staffing_position_id" TEXT,
    "department_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "manager_employment_id" TEXT,
    "work_schedule_code" TEXT,
    "fte" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "probation_end_date" DATE,
    "location_warehouse_id" TEXT,
    "cost_center_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_employments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employment_contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "contract_date" DATE NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "contract_type" TEXT NOT NULL,
    "probation_period_months" INTEGER,
    "work_location" TEXT,
    "working_time_type" TEXT,
    "base_compensation_reference" TEXT,
    "conditions" TEXT,
    "signed_status" TEXT NOT NULL DEFAULT 'UNSIGNED',
    "attachment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_employment_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employment_contract_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "changes" TEXT,
    "source_document" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "hr_employment_contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_positions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "job_family" TEXT,
    "grade" TEXT,
    "category" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_staffing_tables" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_staffing_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_staffing_positions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staffing_table_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "position_id" TEXT NOT NULL,
    "grade" TEXT,
    "headcount_limit" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "fte_limit" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "salary_range_reference" TEXT,
    "work_schedule_default" TEXT,
    "location_warehouse_id" TEXT,
    "cost_center_id" TEXT,
    "active_from" DATE NOT NULL,
    "active_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_staffing_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_hire_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "hire_date" DATE NOT NULL,
    "department_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "staffing_position_id" TEXT,
    "branch_id" TEXT,
    "manager_employment_id" TEXT,
    "work_schedule_code" TEXT,
    "fte" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "probation_end_date" DATE,
    "location_warehouse_id" TEXT,
    "responsible_hr_user_id" TEXT,
    "rehire_of_employee_id" TEXT,
    "employment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_hire_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "position_id" TEXT NOT NULL,
    "staffing_position_id" TEXT,
    "manager_employment_id" TEXT,
    "location_warehouse_id" TEXT,
    "fte" DECIMAL(4,2) NOT NULL,
    "cost_center_id" TEXT,
    "reason" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "hr_employee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "transfer_type" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "new_department_id" TEXT,
    "new_position_id" TEXT,
    "new_staffing_position_id" TEXT,
    "new_branch_id" TEXT,
    "new_manager_employment_id" TEXT,
    "new_location_warehouse_id" TEXT,
    "new_fte" DECIMAL(4,2),
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_employee_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_work_schedule_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "work_schedule_code" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "hr_work_schedule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "leave_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "request_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_leave_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_absence_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "absence_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "supporting_document" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "hr_absence_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employment_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_employment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_termination_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "termination_date" DATE NOT NULL,
    "last_working_date" DATE NOT NULL,
    "termination_reason" TEXT NOT NULL,
    "legal_basis" TEXT,
    "notice_date" DATE,
    "responsible_hr_user_id" TEXT,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_termination_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_physical_persons_tenant_id_personal_id_idx" ON "hr_physical_persons"("tenant_id", "personal_id");

-- CreateIndex
CREATE INDEX "hr_employees_tenant_id_physical_person_id_idx" ON "hr_employees"("tenant_id", "physical_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_tenant_id_personnel_number_key" ON "hr_employees"("tenant_id", "personnel_number");

-- CreateIndex
CREATE INDEX "hr_employments_organization_id_status_idx" ON "hr_employments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "hr_employments_employee_id_idx" ON "hr_employments"("employee_id");

-- CreateIndex
CREATE INDEX "hr_employments_manager_employment_id_idx" ON "hr_employments"("manager_employment_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employment_contracts_employment_id_key" ON "hr_employment_contracts"("employment_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employment_contract_versions_contract_id_version_number_key" ON "hr_employment_contract_versions"("contract_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "hr_positions_tenant_id_code_key" ON "hr_positions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "hr_staffing_tables_organization_id_status_idx" ON "hr_staffing_tables"("organization_id", "status");

-- CreateIndex
CREATE INDEX "hr_staffing_positions_organization_id_status_idx" ON "hr_staffing_positions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "hr_staffing_positions_staffing_table_id_idx" ON "hr_staffing_positions"("staffing_table_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_hire_documents_employment_id_key" ON "hr_hire_documents"("employment_id");

-- CreateIndex
CREATE INDEX "hr_hire_documents_organization_id_status_idx" ON "hr_hire_documents"("organization_id", "status");

-- CreateIndex
CREATE INDEX "hr_employee_assignments_employment_id_effective_from_idx" ON "hr_employee_assignments"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "hr_employee_assignments_employment_id_effective_to_idx" ON "hr_employee_assignments"("employment_id", "effective_to");

-- CreateIndex
CREATE INDEX "hr_employee_transfers_employment_id_idx" ON "hr_employee_transfers"("employment_id");

-- CreateIndex
CREATE INDEX "hr_work_schedule_assignments_employment_id_effective_from_idx" ON "hr_work_schedule_assignments"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "hr_leave_records_employment_id_start_date_idx" ON "hr_leave_records"("employment_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_absence_records_employment_id_start_date_idx" ON "hr_absence_records"("employment_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_employment_status_history_employment_id_effective_from_idx" ON "hr_employment_status_history"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "hr_termination_documents_employment_id_idx" ON "hr_termination_documents"("employment_id");

-- AddForeignKey
ALTER TABLE "hr_physical_persons" ADD CONSTRAINT "hr_physical_persons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_physical_person_id_fkey" FOREIGN KEY ("physical_person_id") REFERENCES "hr_physical_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employments" ADD CONSTRAINT "hr_employments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employments" ADD CONSTRAINT "hr_employments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employments" ADD CONSTRAINT "hr_employments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employments" ADD CONSTRAINT "hr_employments_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employments" ADD CONSTRAINT "hr_employments_manager_employment_id_fkey" FOREIGN KEY ("manager_employment_id") REFERENCES "hr_employments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employment_contracts" ADD CONSTRAINT "hr_employment_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employment_contracts" ADD CONSTRAINT "hr_employment_contracts_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employment_contract_versions" ADD CONSTRAINT "hr_employment_contract_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employment_contract_versions" ADD CONSTRAINT "hr_employment_contract_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "hr_employment_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_staffing_tables" ADD CONSTRAINT "hr_staffing_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_staffing_tables" ADD CONSTRAINT "hr_staffing_tables_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_staffing_positions" ADD CONSTRAINT "hr_staffing_positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_staffing_positions" ADD CONSTRAINT "hr_staffing_positions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_staffing_positions" ADD CONSTRAINT "hr_staffing_positions_staffing_table_id_fkey" FOREIGN KEY ("staffing_table_id") REFERENCES "hr_staffing_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_staffing_positions" ADD CONSTRAINT "hr_staffing_positions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_hire_documents" ADD CONSTRAINT "hr_hire_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_hire_documents" ADD CONSTRAINT "hr_hire_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_hire_documents" ADD CONSTRAINT "hr_hire_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_hire_documents" ADD CONSTRAINT "hr_hire_documents_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_assignments" ADD CONSTRAINT "hr_employee_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_assignments" ADD CONSTRAINT "hr_employee_assignments_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_transfers" ADD CONSTRAINT "hr_employee_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_transfers" ADD CONSTRAINT "hr_employee_transfers_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_work_schedule_assignments" ADD CONSTRAINT "hr_work_schedule_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_work_schedule_assignments" ADD CONSTRAINT "hr_work_schedule_assignments_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_records" ADD CONSTRAINT "hr_leave_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_records" ADD CONSTRAINT "hr_leave_records_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_absence_records" ADD CONSTRAINT "hr_absence_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_absence_records" ADD CONSTRAINT "hr_absence_records_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employment_status_history" ADD CONSTRAINT "hr_employment_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employment_status_history" ADD CONSTRAINT "hr_employment_status_history_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_termination_documents" ADD CONSTRAINT "hr_termination_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_termination_documents" ADD CONSTRAINT "hr_termination_documents_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "hr_employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
