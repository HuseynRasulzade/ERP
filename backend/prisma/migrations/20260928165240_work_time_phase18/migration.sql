-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "work_time_production_calendars" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "country_code" TEXT,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_time_production_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_production_calendar_days" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "day_type" TEXT NOT NULL,
    "default_working_hours" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "holiday_code" TEXT,
    "shortened_by_hours" DECIMAL(4,2),
    "transferred_from_date" DATE,
    "transferred_to_date" DATE,
    "notes" TEXT,

    CONSTRAINT "work_time_production_calendar_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_schedule_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule_type" TEXT NOT NULL DEFAULT 'STANDARD_WEEK',
    "cycle_length_days" INTEGER NOT NULL DEFAULT 7,
    "default_weekly_hours" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "uses_production_calendar" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "work_time_schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_shift_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_duration_minutes" INTEGER NOT NULL DEFAULT 0,
    "planned_hours" DECIMAL(4,2) NOT NULL,
    "crosses_midnight" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "work_time_shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_schedule_patterns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_template_id" TEXT NOT NULL,
    "cycle_day" INTEGER NOT NULL,
    "day_type" TEXT NOT NULL DEFAULT 'WORK',
    "work_start_time" TEXT,
    "work_end_time" TEXT,
    "break_duration_minutes" INTEGER NOT NULL DEFAULT 0,
    "planned_hours" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "crosses_midnight" BOOLEAN NOT NULL DEFAULT false,
    "shift_template_id" TEXT,

    CONSTRAINT "work_time_schedule_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_daily_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "schedule_template_id" TEXT,
    "production_calendar_id" TEXT,
    "shift_template_id" TEXT,
    "planned_start" TEXT,
    "planned_end" TEXT,
    "planned_hours" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "planned_workday_fraction" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "planned_day_type" TEXT NOT NULL,
    "fte" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "department_id" TEXT,
    "position_id" TEXT,
    "source_schedule_version" INTEGER,
    "source_calendar_version" INTEGER,
    "generation_status" TEXT NOT NULL DEFAULT 'GENERATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_time_daily_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_attendance_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "event_timestamp" TIMESTAMP(3) NOT NULL,
    "event_type" TEXT NOT NULL,
    "location" TEXT,
    "device_id" TEXT,
    "external_event_id" TEXT,
    "source_system" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RAW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "work_time_attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_attendance_intervals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "source_event_ids" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_time_attendance_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_time_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "hours" DECIMAL(5,2) NOT NULL,
    "time_code" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approval_status" TEXT NOT NULL DEFAULT 'PENDING',
    "superseded_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "work_time_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_timesheets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "timesheet_number" TEXT,
    "responsible_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generated_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "work_time_timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_timesheet_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "timesheet_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "department_id" TEXT,
    "planned_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "regular_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "overtime_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "night_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "holiday_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "weekend_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "leave_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "absence_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "business_trip_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "paid_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unpaid_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "worked_day_fraction" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "validation_status" TEXT NOT NULL DEFAULT 'OK',
    "validation_notes" TEXT,

    CONSTRAINT "work_time_timesheet_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_overtime_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requested_hours" DECIMAL(4,2),
    "approved_hours" DECIMAL(4,2),
    "actual_hours" DECIMAL(4,2),
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "work_time_overtime_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_corrections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "original_time_entry_id" TEXT,
    "new_time_entry_id" TEXT,
    "corrected_time_code" TEXT,
    "corrected_hours" DECIMAL(5,2),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requires_recalculation" BOOLEAN NOT NULL DEFAULT false,
    "applied_at" TIMESTAMP(3),
    "applied_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "work_time_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "timesheet_status" TEXT,
    "payroll_input_status" TEXT,
    "locked_at" TIMESTAMP(3),
    "reopened_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_time_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_payroll_inputs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "payroll_period_start" DATE NOT NULL,
    "payroll_period_end" DATE NOT NULL,
    "time_code" TEXT NOT NULL,
    "premium_type" TEXT,
    "hours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "days" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "source_timesheet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_time_payroll_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_time_production_calendars_tenant_id_organization_id_ye_idx" ON "work_time_production_calendars"("tenant_id", "organization_id", "year");

-- CreateIndex
CREATE INDEX "work_time_production_calendar_days_tenant_id_date_idx" ON "work_time_production_calendar_days"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_production_calendar_days_calendar_id_date_key" ON "work_time_production_calendar_days"("calendar_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_schedule_templates_tenant_id_code_key" ON "work_time_schedule_templates"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_shift_templates_tenant_id_code_key" ON "work_time_shift_templates"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_schedule_patterns_schedule_template_id_cycle_day_key" ON "work_time_schedule_patterns"("schedule_template_id", "cycle_day");

-- CreateIndex
CREATE INDEX "work_time_daily_plans_organization_id_date_idx" ON "work_time_daily_plans"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_daily_plans_employment_id_date_key" ON "work_time_daily_plans"("employment_id", "date");

-- CreateIndex
CREATE INDEX "work_time_attendance_events_tenant_id_employment_id_event_t_idx" ON "work_time_attendance_events"("tenant_id", "employment_id", "event_timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_attendance_events_source_system_external_event_id_key" ON "work_time_attendance_events"("source_system", "external_event_id");

-- CreateIndex
CREATE INDEX "work_time_attendance_intervals_tenant_id_employment_id_work_idx" ON "work_time_attendance_intervals"("tenant_id", "employment_id", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_time_entries_superseded_by_id_key" ON "work_time_time_entries"("superseded_by_id");

-- CreateIndex
CREATE INDEX "work_time_time_entries_tenant_id_employment_id_workDate_idx" ON "work_time_time_entries"("tenant_id", "employment_id", "workDate");

-- CreateIndex
CREATE INDEX "work_time_timesheets_organization_id_period_start_idx" ON "work_time_timesheets"("organization_id", "period_start");

-- CreateIndex
CREATE INDEX "work_time_timesheet_lines_employment_id_workDate_idx" ON "work_time_timesheet_lines"("employment_id", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_timesheet_lines_timesheet_id_employment_id_workDa_key" ON "work_time_timesheet_lines"("timesheet_id", "employment_id", "workDate");

-- CreateIndex
CREATE INDEX "work_time_overtime_records_employment_id_date_idx" ON "work_time_overtime_records"("employment_id", "date");

-- CreateIndex
CREATE INDEX "work_time_corrections_employment_id_workDate_idx" ON "work_time_corrections"("employment_id", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "work_time_periods_organization_id_period_start_period_end_key" ON "work_time_periods"("organization_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "work_time_payroll_inputs_employment_id_payroll_period_start_idx" ON "work_time_payroll_inputs"("employment_id", "payroll_period_start");

-- CreateIndex
CREATE INDEX "work_time_payroll_inputs_organization_id_status_idx" ON "work_time_payroll_inputs"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "work_time_production_calendars" ADD CONSTRAINT "work_time_production_calendars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_production_calendars" ADD CONSTRAINT "work_time_production_calendars_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_production_calendar_days" ADD CONSTRAINT "work_time_production_calendar_days_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_production_calendar_days" ADD CONSTRAINT "work_time_production_calendar_days_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "work_time_production_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_schedule_templates" ADD CONSTRAINT "work_time_schedule_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_shift_templates" ADD CONSTRAINT "work_time_shift_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_schedule_patterns" ADD CONSTRAINT "work_time_schedule_patterns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_schedule_patterns" ADD CONSTRAINT "work_time_schedule_patterns_schedule_template_id_fkey" FOREIGN KEY ("schedule_template_id") REFERENCES "work_time_schedule_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_schedule_patterns" ADD CONSTRAINT "work_time_schedule_patterns_shift_template_id_fkey" FOREIGN KEY ("shift_template_id") REFERENCES "work_time_shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_daily_plans" ADD CONSTRAINT "work_time_daily_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_daily_plans" ADD CONSTRAINT "work_time_daily_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_daily_plans" ADD CONSTRAINT "work_time_daily_plans_schedule_template_id_fkey" FOREIGN KEY ("schedule_template_id") REFERENCES "work_time_schedule_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_daily_plans" ADD CONSTRAINT "work_time_daily_plans_production_calendar_id_fkey" FOREIGN KEY ("production_calendar_id") REFERENCES "work_time_production_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_daily_plans" ADD CONSTRAINT "work_time_daily_plans_shift_template_id_fkey" FOREIGN KEY ("shift_template_id") REFERENCES "work_time_shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_attendance_events" ADD CONSTRAINT "work_time_attendance_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_attendance_intervals" ADD CONSTRAINT "work_time_attendance_intervals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_time_entries" ADD CONSTRAINT "work_time_time_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_time_entries" ADD CONSTRAINT "work_time_time_entries_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "work_time_time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_timesheets" ADD CONSTRAINT "work_time_timesheets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_timesheets" ADD CONSTRAINT "work_time_timesheets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_timesheet_lines" ADD CONSTRAINT "work_time_timesheet_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_timesheet_lines" ADD CONSTRAINT "work_time_timesheet_lines_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "work_time_timesheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_overtime_records" ADD CONSTRAINT "work_time_overtime_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_corrections" ADD CONSTRAINT "work_time_corrections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_periods" ADD CONSTRAINT "work_time_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_periods" ADD CONSTRAINT "work_time_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_payroll_inputs" ADD CONSTRAINT "work_time_payroll_inputs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_payroll_inputs" ADD CONSTRAINT "work_time_payroll_inputs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
