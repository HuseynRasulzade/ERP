-- CreateTable
CREATE TABLE "physical_persons" (
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
    "tax_id" TEXT,
    "passport_number" TEXT,
    "identity_documents" JSONB,
    "personal_email" TEXT,
    "personal_phone" TEXT,
    "address" TEXT,
    "emergency_contact" JSONB,
    "photo_url" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "physical_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "physical_person_id" TEXT NOT NULL,
    "personnel_number" TEXT NOT NULL,
    "employee_code" TEXT,
    "default_organization_id" TEXT,
    "default_language" TEXT,
    "corporate_email" TEXT,
    "corporate_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "hire_first_date" DATE,
    "last_termination_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "employment_status" TEXT NOT NULL DEFAULT 'PLANNED',
    "employment_start_date" DATE NOT NULL,
    "employment_end_date" DATE,
    "primary_employment" BOOLEAN NOT NULL DEFAULT true,
    "contract_id" TEXT,
    "staffing_position_id" TEXT,
    "department_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "manager_employment_id" TEXT,
    "work_schedule_id" TEXT,
    "fte" DECIMAL(6,4) NOT NULL DEFAULT 1,
    "probation_end_date" DATE,
    "location" TEXT,
    "cost_center" TEXT,
    "project" TEXT,
    "hire_document_id" TEXT,
    "rehire_of_employment_id" TEXT,
    "termination_reason_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employment_id" TEXT,
    "contract_number" TEXT NOT NULL,
    "contract_date" DATE NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "contract_type" TEXT NOT NULL,
    "probation_period_days" INTEGER,
    "work_location" TEXT,
    "working_time_type" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "base_compensation_reference" TEXT,
    "conditions" TEXT,
    "signed_status" TEXT NOT NULL DEFAULT 'UNSIGNED',
    "attachment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employment_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_contract_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "terms" JSONB NOT NULL,
    "changes" JSONB,
    "reason" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "employment_contract_versions_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "hr_work_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule_type" TEXT NOT NULL DEFAULT 'STANDARD_WEEK',
    "weekly_hours" DECIMAL(6,2),
    "template_ref" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hr_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staffing_tables" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "previous_table_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staffing_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staffing_positions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staffing_table_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "position_id" TEXT NOT NULL,
    "grade" TEXT,
    "headcount_limit" INTEGER NOT NULL,
    "fte_limit" DECIMAL(8,4) NOT NULL,
    "salary_range_reference" TEXT,
    "default_work_schedule_id" TEXT,
    "location" TEXT,
    "cost_center" TEXT,
    "active_from" DATE NOT NULL,
    "active_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staffing_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hire_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'HR_HIRE',
    "number" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "hire_date" DATE NOT NULL,
    "is_rehire" BOOLEAN NOT NULL DEFAULT false,
    "previous_employment_id" TEXT,
    "physical_person_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "primary_employment" BOOLEAN NOT NULL DEFAULT true,
    "contract_id" TEXT,
    "department_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "staffing_position_id" TEXT,
    "branch_id" TEXT,
    "manager_employment_id" TEXT,
    "work_schedule_id" TEXT,
    "fte" DECIMAL(6,4) NOT NULL DEFAULT 1,
    "probation_end_date" DATE,
    "location" TEXT,
    "cost_center" TEXT,
    "project" TEXT,
    "responsible_hr_user_id" TEXT,
    "override_staffing_limit" BOOLEAN NOT NULL DEFAULT false,
    "employment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "warnings" JSONB,
    "posting_snapshot" JSONB,
    "comment" TEXT,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hire_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "position_id" TEXT NOT NULL,
    "staffing_position_id" TEXT,
    "manager_employment_id" TEXT,
    "location" TEXT,
    "fte" DECIMAL(6,4) NOT NULL,
    "cost_center" TEXT,
    "project" TEXT,
    "is_secondary" BOOLEAN NOT NULL DEFAULT false,
    "event_type" TEXT NOT NULL,
    "reason" TEXT,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "record_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "employee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'HR_TRANSFER',
    "number" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "batch_number" TEXT,
    "employment_id" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "transfer_type" TEXT NOT NULL,
    "old_assignment_id" TEXT,
    "new_department_id" TEXT,
    "new_position_id" TEXT,
    "new_staffing_position_id" TEXT,
    "new_branch_id" TEXT,
    "new_manager_employment_id" TEXT,
    "clear_manager" BOOLEAN NOT NULL DEFAULT false,
    "new_location" TEXT,
    "new_fte" DECIMAL(6,4),
    "new_cost_center" TEXT,
    "new_project" TEXT,
    "new_work_schedule_id" TEXT,
    "reason" TEXT,
    "override_staffing_limit" BOOLEAN NOT NULL DEFAULT false,
    "result_assignment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "warnings" JSONB,
    "posting_snapshot" JSONB,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employee_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedule_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "work_schedule_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "record_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "work_schedule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "source_document_type" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "record_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "employment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "leave_type_code" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "request_date" DATE NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "leave_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absence_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "absence_type_code" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "hours" DECIMAL(6,2),
    "reason" TEXT,
    "supporting_document" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "absence_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_trips" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "business_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "termination_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'HR_TERMINATION',
    "number" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "employment_id" TEXT NOT NULL,
    "termination_date" DATE NOT NULL,
    "last_working_date" DATE NOT NULL,
    "termination_reason_code" TEXT NOT NULL,
    "legal_basis" TEXT,
    "notice_date" DATE,
    "final_schedule_date" DATE,
    "responsible_hr_user_id" TEXT,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "warnings" JSONB,
    "posting_snapshot" JSONB,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "termination_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_attribute_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employment_id" TEXT,
    "attribute_type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "employee_attribute_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_bank_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "currency_code" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "employee_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_personnel_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "document_category" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'PERSONAL',
    "file_name" TEXT NOT NULL,
    "file_type" TEXT,
    "file_size" INTEGER,
    "storage_key" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_personnel_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_catalog_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "catalog_type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_az" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "employee_id" TEXT,
    "employment_id" TEXT,
    "organization_id" TEXT,
    "effective_date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),

    CONSTRAINT "hr_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "physical_persons_tenant_id_idx" ON "physical_persons"("tenant_id");

-- CreateIndex
CREATE INDEX "physical_persons_tenant_id_last_name_first_name_idx" ON "physical_persons"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "physical_persons_tenant_id_birth_date_idx" ON "physical_persons"("tenant_id", "birth_date");

-- CreateIndex
CREATE INDEX "physical_persons_tenant_id_personal_email_idx" ON "physical_persons"("tenant_id", "personal_email");

-- CreateIndex
CREATE INDEX "physical_persons_tenant_id_personal_phone_idx" ON "physical_persons"("tenant_id", "personal_phone");

-- CreateIndex
CREATE UNIQUE INDEX "physical_persons_tenant_id_personal_id_key" ON "physical_persons"("tenant_id", "personal_id");

-- CreateIndex
CREATE UNIQUE INDEX "physical_persons_tenant_id_passport_number_key" ON "physical_persons"("tenant_id", "passport_number");

-- CreateIndex
CREATE INDEX "employees_tenant_id_status_idx" ON "employees"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_personnel_number_key" ON "employees"("tenant_id", "personnel_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_physical_person_id_key" ON "employees"("tenant_id", "physical_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "employments_hire_document_id_key" ON "employments"("hire_document_id");

-- CreateIndex
CREATE INDEX "employments_tenant_id_idx" ON "employments"("tenant_id");

-- CreateIndex
CREATE INDEX "employments_tenant_id_employee_id_idx" ON "employments"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employments_tenant_id_organization_id_employment_status_idx" ON "employments"("tenant_id", "organization_id", "employment_status");

-- CreateIndex
CREATE INDEX "employments_department_id_idx" ON "employments"("department_id");

-- CreateIndex
CREATE INDEX "employments_position_id_idx" ON "employments"("position_id");

-- CreateIndex
CREATE INDEX "employments_staffing_position_id_idx" ON "employments"("staffing_position_id");

-- CreateIndex
CREATE INDEX "employments_manager_employment_id_idx" ON "employments"("manager_employment_id");

-- CreateIndex
CREATE INDEX "employments_tenant_id_employment_start_date_employment_end__idx" ON "employments"("tenant_id", "employment_start_date", "employment_end_date");

-- CreateIndex
CREATE INDEX "employment_contracts_tenant_id_employee_id_idx" ON "employment_contracts"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employment_contracts_employment_id_idx" ON "employment_contracts"("employment_id");

-- CreateIndex
CREATE INDEX "employment_contracts_tenant_id_effective_to_idx" ON "employment_contracts"("tenant_id", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "employment_contracts_tenant_id_organization_id_contract_num_key" ON "employment_contracts"("tenant_id", "organization_id", "contract_number");

-- CreateIndex
CREATE INDEX "employment_contract_versions_contract_id_effective_from_idx" ON "employment_contract_versions"("contract_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "employment_contract_versions_contract_id_version_number_key" ON "employment_contract_versions"("contract_id", "version_number");

-- CreateIndex
CREATE INDEX "hr_positions_tenant_id_active_idx" ON "hr_positions"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "hr_positions_tenant_id_code_key" ON "hr_positions"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_work_schedules_tenant_id_code_key" ON "hr_work_schedules"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "staffing_tables_tenant_id_organization_id_effective_from_idx" ON "staffing_tables"("tenant_id", "organization_id", "effective_from");

-- CreateIndex
CREATE INDEX "staffing_positions_tenant_id_organization_id_code_idx" ON "staffing_positions"("tenant_id", "organization_id", "code");

-- CreateIndex
CREATE INDEX "staffing_positions_department_id_idx" ON "staffing_positions"("department_id");

-- CreateIndex
CREATE INDEX "staffing_positions_position_id_idx" ON "staffing_positions"("position_id");

-- CreateIndex
CREATE UNIQUE INDEX "staffing_positions_staffing_table_id_code_key" ON "staffing_positions"("staffing_table_id", "code");

-- CreateIndex
CREATE INDEX "hire_documents_tenant_id_organization_id_status_idx" ON "hire_documents"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "hire_documents_tenant_id_employee_id_idx" ON "hire_documents"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "hire_documents_tenant_id_hire_date_idx" ON "hire_documents"("tenant_id", "hire_date");

-- CreateIndex
CREATE UNIQUE INDEX "hire_documents_tenant_id_number_key" ON "hire_documents"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "employee_assignments_tenant_id_idx" ON "employee_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "employee_assignments_employment_id_effective_from_idx" ON "employee_assignments"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "employee_assignments_employment_id_effective_to_idx" ON "employee_assignments"("employment_id", "effective_to");

-- CreateIndex
CREATE INDEX "employee_assignments_tenant_id_organization_id_effective_fr_idx" ON "employee_assignments"("tenant_id", "organization_id", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "employee_assignments_department_id_idx" ON "employee_assignments"("department_id");

-- CreateIndex
CREATE INDEX "employee_assignments_position_id_idx" ON "employee_assignments"("position_id");

-- CreateIndex
CREATE INDEX "employee_assignments_staffing_position_id_idx" ON "employee_assignments"("staffing_position_id");

-- CreateIndex
CREATE INDEX "employee_assignments_manager_employment_id_idx" ON "employee_assignments"("manager_employment_id");

-- CreateIndex
CREATE INDEX "employee_assignments_source_document_type_source_document_i_idx" ON "employee_assignments"("source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "employee_transfers_tenant_id_employment_id_effective_date_idx" ON "employee_transfers"("tenant_id", "employment_id", "effective_date");

-- CreateIndex
CREATE INDEX "employee_transfers_tenant_id_organization_id_status_idx" ON "employee_transfers"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "employee_transfers_tenant_id_batch_number_idx" ON "employee_transfers"("tenant_id", "batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "employee_transfers_tenant_id_number_key" ON "employee_transfers"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "work_schedule_assignments_tenant_id_idx" ON "work_schedule_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "work_schedule_assignments_employment_id_effective_from_idx" ON "work_schedule_assignments"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "work_schedule_assignments_employment_id_effective_to_idx" ON "work_schedule_assignments"("employment_id", "effective_to");

-- CreateIndex
CREATE INDEX "work_schedule_assignments_work_schedule_id_idx" ON "work_schedule_assignments"("work_schedule_id");

-- CreateIndex
CREATE INDEX "employment_status_history_tenant_id_idx" ON "employment_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "employment_status_history_employment_id_effective_from_idx" ON "employment_status_history"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "employment_status_history_employment_id_effective_to_idx" ON "employment_status_history"("employment_id", "effective_to");

-- CreateIndex
CREATE INDEX "employment_status_history_tenant_id_status_idx" ON "employment_status_history"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leave_records_tenant_id_employment_id_start_date_idx" ON "leave_records"("tenant_id", "employment_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_records_tenant_id_organization_id_status_idx" ON "leave_records"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "absence_records_tenant_id_employment_id_start_date_idx" ON "absence_records"("tenant_id", "employment_id", "start_date");

-- CreateIndex
CREATE INDEX "absence_records_tenant_id_organization_id_status_idx" ON "absence_records"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE INDEX "business_trips_tenant_id_employment_id_start_date_idx" ON "business_trips"("tenant_id", "employment_id", "start_date");

-- CreateIndex
CREATE INDEX "termination_documents_tenant_id_employment_id_idx" ON "termination_documents"("tenant_id", "employment_id");

-- CreateIndex
CREATE INDEX "termination_documents_tenant_id_organization_id_termination_idx" ON "termination_documents"("tenant_id", "organization_id", "termination_date");

-- CreateIndex
CREATE UNIQUE INDEX "termination_documents_tenant_id_number_key" ON "termination_documents"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "employee_attribute_history_tenant_id_employee_id_attribute__idx" ON "employee_attribute_history"("tenant_id", "employee_id", "attribute_type", "effective_from");

-- CreateIndex
CREATE INDEX "employee_bank_accounts_tenant_id_employee_id_idx" ON "employee_bank_accounts"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_personnel_documents_tenant_id_owner_type_owner_id_active_idx" ON "hr_personnel_documents"("tenant_id", "owner_type", "owner_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "hr_catalog_items_tenant_id_catalog_type_code_key" ON "hr_catalog_items"("tenant_id", "catalog_type", "code");

-- CreateIndex
CREATE INDEX "hr_events_tenant_id_status_created_at_idx" ON "hr_events"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "hr_events_tenant_id_employment_id_effective_date_idx" ON "hr_events"("tenant_id", "employment_id", "effective_date");

-- CreateIndex
CREATE INDEX "hr_events_tenant_id_event_type_idx" ON "hr_events"("tenant_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "hr_events_tenant_id_idempotency_key_key" ON "hr_events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "hr_periods_tenant_id_period_start_period_end_idx" ON "hr_periods"("tenant_id", "period_start", "period_end");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_physical_person_id_fkey" FOREIGN KEY ("physical_person_id") REFERENCES "physical_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employments" ADD CONSTRAINT "employments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employments" ADD CONSTRAINT "employments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employments" ADD CONSTRAINT "employments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employments" ADD CONSTRAINT "employments_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employments" ADD CONSTRAINT "employments_manager_employment_id_fkey" FOREIGN KEY ("manager_employment_id") REFERENCES "employments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contract_versions" ADD CONSTRAINT "employment_contract_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "employment_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staffing_tables" ADD CONSTRAINT "staffing_tables_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staffing_positions" ADD CONSTRAINT "staffing_positions_staffing_table_id_fkey" FOREIGN KEY ("staffing_table_id") REFERENCES "staffing_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staffing_positions" ADD CONSTRAINT "staffing_positions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staffing_positions" ADD CONSTRAINT "staffing_positions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedule_assignments" ADD CONSTRAINT "work_schedule_assignments_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_history" ADD CONSTRAINT "employment_status_history_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_records" ADD CONSTRAINT "leave_records_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_records" ADD CONSTRAINT "absence_records_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_trips" ADD CONSTRAINT "business_trips_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attribute_history" ADD CONSTRAINT "employee_attribute_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

