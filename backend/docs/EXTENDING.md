# Adding a new document type (Phase 1+)

This is the extension guide required by spec section 74. Follow
`src/foundation-test-document/*` as the working template — every file below
has a direct counterpart there.

1. **Define the document model** — add a concrete Prisma model mirroring
   `BaseDocumentFields` (`src/document-framework/base-document.ts`): id,
   tenantId, organizationId?, documentType, number, documentDate,
   postingDate?, status, postingStatus, currencyId?, exchangeRate?,
   description?, created/updated/posted/cancelled audit columns, version,
   deletionMark — plus whatever business-specific fields the document
   needs. Do **not** add it to a shared generic `documents` table
   (section 71/72).

2. **Define permissions** — add `<module>.<resource>.<action>` codes to
   that module's own permission-codes file (or extend
   `src/rbac/permission-codes.ts` if it's core), and include them in
   `prisma/seed.ts` so `TENANT_ADMIN` picks them up automatically.

3. **Configure numbering** — either let tenants create a
   `NumberSequence` via `POST /number-sequences`, or auto-provision one on
   first use the way `FoundationTestDocumentService.ensureSequence` does.

4. **Implement a `DocumentRepositoryAdapter`**
   (`src/document-framework/document-repository.interface.ts`):
   `findById`, `applyStatusPatch` (optimistic-concurrency guarded status
   transition), `create`. See
   `foundation-test-document.repository.ts`.

5. **Implement a `DocumentPostingHandler`**
   (`src/document-framework/document-posting-handler.interface.ts`):
   `validateForPosting` (business + posting validation) and
   `buildMovements` (pure computation of the `RegisterMovementInput[]` this
   document should generate — no side effects). See
   `foundation-test-document.posting-handler.ts`. A document type with
   nothing to post yet can still register a handler whose
   `buildMovements` returns `[]`.

6. **Register the handler + repository** in the module's
   `onModuleInit` via `DocumentFrameworkRegistry.registerHandler` /
   `registerRepository` — never edit `DocumentPostingService` itself.

7. **Define a Create Based On mapper if needed**
   (`src/document-link/create-based-on.interfaces.ts`): implement
   `CreateBasedOnMapper.mapHeader(source)` and register it via
   `DocumentFrameworkRegistry.registerMapper`. Only needed for document
   types that participate in a "create X based on Y" chain.

8. **Wire the module** — import `DocumentFrameworkModule` (+
   `NumberingModule`, `AuditModule`, `PeriodModule` as needed) in the new
   module, register everything in `onModuleInit`, and add the module to
   `AppModule`.

9. **Expose endpoints** — a controller for
   list/get/create/update (never posting-status fields directly), plus the
   framework already provides generic
   `POST /documents/:type/:id/{post,unpost,cancel}` and
   `POST /documents/:type/:id/create-based-on/:targetType` for free once
   registered.

10. **Add tests** — at minimum: tenant isolation, save-vs-post, posting
    atomicity (force a mid-transaction failure), period-closed blocks
    posting, optimistic-concurrency conflict, and (if numbering is new)
    a concurrent-allocation test. Copy the shape of
    `test/phase0.e2e-spec.ts`.

Nothing in `DocumentFrameworkModule`, `PeriodModule`, `NumberingModule`,
`AuditModule`, or `DocumentLinkModule` needs to change for any of the
above — that is the point of the registry-based design.
