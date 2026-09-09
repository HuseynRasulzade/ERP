# Phase 0 — Permission matrix

All Phase 0 permission codes (`src/rbac/permission-codes.ts`, seeded by
`prisma/seed.ts`). The seeded system role `TENANT_ADMIN` is granted every
permission that exists at seed time; a tenant is never left without an
administrator. Custom roles with any subset of these codes can be created
via `POST /roles`.

| Code | Module | Description |
|---|---|---|
| `core.users.view` | core | View users in the tenant |
| `core.users.manage` | core | Manage tenant memberships |
| `core.roles.view` | core | View roles and permissions |
| `core.roles.manage` | core | Manage roles and role permissions |
| `core.tenant.manage` | core | Manage tenant-level configuration (organizations, ...) |
| `core.settings.view` | core | View scoped settings |
| `core.settings.manage` | core | Manage scoped settings |
| `documents.view` | documents | View documents |
| `documents.create` | documents | Create documents |
| `documents.edit` | documents | Edit documents |
| `documents.delete` | documents | Mark documents for deletion |
| `documents.post` | documents | Post documents |
| `documents.unpost` | documents | Unpost documents |
| `documents.cancel` | documents | Cancel documents |
| `periods.view` | periods | View accounting periods |
| `periods.close` | periods | Close accounting periods |
| `periods.reopen` | periods | Reopen accounting periods |
| `audit.view` | audit | View audit events |
| `currency.manage` | currency | Manage currencies and exchange rates |
| `numbering.manage` | numbering | Manage numbering sequences |

Additionally, `@SystemAdminOnly()` gates platform/system-administrator
operations on `User.isSystemAdmin` directly (section 7) — this is
independent of any tenant role and is never reachable via `TENANT_ADMIN`.

Future modules append their own `<module>.<resource>.<action>` codes (e.g.
`sales.invoice.post`, `inventory.transfer.post`) the same way — business
logic must never branch on a role name, only on one of these codes.

## Later phases

Phase 1 (organization & structure): `organization.*`, `branch.*`,
`department.*`, `responsible_person.*`, `warehouse.*`, `cashbox.*`,
`bank_account.*`, `accounting_policy.*`, `tax_profile.*`,
`organization_access.manage`.

Phase 2 (product catalog): `unit_of_measure.*`, `product_category.*`,
`product.*` (63 total codes after Phase 2).

Phase 3 (counterparty + pricing, 77 total): `unit_conversion.*`,
`counterparty.*`, `price_list.*`, `product_price.*`.

Phase 4 (sales documents, 83 total): `sales_order.{view,create,edit}` ·
`sales_invoice.{view,create,edit}`. Posting sales documents reuses the
Phase 0 `documents.post|unpost|cancel` codes via the generic
`/documents/SALES_ORDER| SALES_INVOICE/:id/...` commands — there are no
per-document post codes.
