-- Section 41: at most one default, active bank account per organization.
-- Enforced as a partial unique index (Prisma's declarative schema cannot
-- express a WHERE clause on a unique constraint) so a race between two
-- concurrent "set as default" requests cannot leave two defaults behind.
CREATE UNIQUE INDEX "bank_accounts_one_default_per_org"
  ON "bank_accounts" ("organization_id")
  WHERE "is_default" = true AND "active" = true;
