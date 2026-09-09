-- AlterTable
CREATE SEQUENCE accounting_movements_posting_sequence_seq;
ALTER TABLE "accounting_movements" ALTER COLUMN "posting_sequence" SET DEFAULT nextval('accounting_movements_posting_sequence_seq');
ALTER SEQUENCE accounting_movements_posting_sequence_seq OWNED BY "accounting_movements"."posting_sequence";

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';
