-- Phases 0-5 verification audit (docs/AUDIT_PHASES_00_05.md).
--
-- Database-level immutability guards for the append-only / posted
-- registers. Application code already never edits these rows; these
-- triggers make that a structural guarantee rather than a convention
-- (Phase 0 sections 24 & 40, Phase 4 section 36, Phase 5 section 66).
-- No table, column or index is added or changed, so the Prisma schema is
-- unaffected (triggers are invisible to `prisma migrate diff`).
--
-- TRUNCATE is deliberately NOT blocked: retention/archival stays possible
-- as an explicit system (DBA) operation, as Phase 0 section 24 allows.

-- 1. Audit journal: append-only. No UPDATE, no DELETE.
CREATE OR REPLACE FUNCTION erp_audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON "audit_events";
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION erp_audit_events_append_only();

-- 2. Posted General Ledger movements: never UPDATEd. Unposting removes a
--    recorder's movements transactionally (DELETE stays allowed); a
--    correction is a reversal, i.e. new rows — never an edited amount.
CREATE OR REPLACE FUNCTION erp_ledger_rows_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable once posted: UPDATE is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounting_movements_immutable ON "accounting_movements";
CREATE TRIGGER accounting_movements_immutable
  BEFORE UPDATE ON "accounting_movements"
  FOR EACH ROW EXECUTE FUNCTION erp_ledger_rows_immutable();

DROP TRIGGER IF EXISTS accounting_movement_dimensions_immutable ON "accounting_movement_dimensions";
CREATE TRIGGER accounting_movement_dimensions_immutable
  BEFORE UPDATE ON "accounting_movement_dimensions"
  FOR EACH ROW EXECUTE FUNCTION erp_ledger_rows_immutable();

-- 3. Tax Register movements: immutable except for the one-time drill-down
--    back-fill of journal_entry_id (NULL -> the Journal Entry posted in the
--    same transaction, see DocumentPostingService / TaxRegisterService).
CREATE OR REPLACE FUNCTION erp_tax_movements_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN
    RAISE EXCEPTION 'tax_movements.journal_entry_id can only be set once'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'journal_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'journal_entry_id') THEN
    RAISE EXCEPTION 'tax_movements rows are immutable once posted: only the journal_entry_id link may be back-filled'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tax_movements_immutable ON "tax_movements";
CREATE TRIGGER tax_movements_immutable
  BEFORE UPDATE ON "tax_movements"
  FOR EACH ROW EXECUTE FUNCTION erp_tax_movements_immutable();

-- 4. Effective-dated organization configuration (Phase 1 sections 29-30):
--    "prevent overlapping configurations ... use database constraints where
--    technically feasible". The services already reject overlaps, but two
--    concurrent creates could both pass that read-then-write check; an
--    exclusion constraint makes overlapping ACTIVE versions impossible.
--    `daterange(valid_from, valid_to, '[]')` treats a NULL valid_to as
--    open-ended, matching the application's inclusive-range semantics.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "accounting_policies"
  ADD CONSTRAINT "accounting_policies_no_overlap"
  EXCLUDE USING gist ("organization_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("active");

ALTER TABLE "tax_profiles"
  ADD CONSTRAINT "tax_profiles_no_overlap"
  EXCLUDE USING gist ("organization_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("active");
