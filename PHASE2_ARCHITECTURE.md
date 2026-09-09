# Phase 2 - Architecture Overview

## System Architecture (Phases 0, 1, 2)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Phase 0 - Foundation                     │
│  ┌────────────┐  ┌─────────┐  ┌──────┐  ┌────────┐  ┌────────┐│
│  │  Identity  │  │ Tenant  │  │ RBAC │  │ Audit  │  │ Period ││
│  │   & Auth   │  │ Context │  │      │  │        │  │        ││
│  └────────────┘  └─────────┘  └──────┘  └────────┘  └────────┘│
│  ┌────────────┐  ┌─────────────┐  ┌──────────────────────────┐│
│  │ Document   │  │  Numbering  │  │  Currency & Exchange     ││
│  │ Framework  │  │   Engine    │  │       Rates              ││
│  └────────────┘  └─────────────┘  └──────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Phase 1 - Organization Structure                │
│  ┌──────────────┐  ┌────────┐  ┌────────────┐  ┌────────────┐ │
│  │ Organization │  │ Branch │  │ Department │  │  Warehouse │ │
│  │              │  │        │  │            │  │            │ │
│  └──────────────┘  └────────┘  └────────────┘  └────────────┘ │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────────┐│
│  │  Cashbox   │  │ Bank Account │  │  Accounting & Tax       ││
│  │            │  │              │  │      Profiles           ││
│  └────────────┘  └──────────────┘  └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Phase 2 - Product/Nomenclature Master Data         │
│  ┌───────────────────┐                                          │
│  │  UnitOfMeasure    │  (Tenant-scoped)                         │
│  │  - kg, piece, L   │                                          │
│  └───────────────────┘                                          │
│           │                                                      │
│           │ references                                           │
│           ▼                                                      │
│  ┌───────────────────┐         ┌──────────────────────┐        │
│  │ ProductCategory   │◄────────│     Product          │        │
│  │  (hierarchical)   │ parent  │  - code, name, type  │        │
│  │  - Electronics    │         │  - SKU, barcode      │        │
│  │    └─ Laptops     │         │  - weight, volume    │        │
│  └───────────────────┘         └──────────────────────┘        │
│   (Organization-scoped)          (Organization-scoped)          │
└─────────────────────────────────────────────────────────────────┘
                              ▼
                    Phase 3+ (Future Phases)
                   Pricing, Inventory, Sales...
```

## Data Model Relationships

```
Tenant
 ├─ UnitOfMeasure (many)
 │   └─ Product.baseUnit (many)
 │
 └─ Organization (many)
     ├─ ProductCategory (many)
     │   ├─ parentCategory (self-reference)
     │   └─ Product.category (many)
     │
     └─ Product (many)
         ├─ baseUnit → UnitOfMeasure
         ├─ category → ProductCategory
         ├─ weightUnit → UnitOfMeasure (optional)
         └─ volumeUnit → UnitOfMeasure (optional)
```

## Request Flow Example

### Creating a Product

```
1. HTTP Request
   POST /organizations/{orgId}/products
   Headers: Authorization, X-Tenant-Id
   Body: { code, name, productType, baseUnitId, categoryId, ... }
   
   ▼

2. Guard Chain (Phase 0)
   JwtAuthGuard → verify JWT, extract userId
   TenantContextGuard → load membership, permissions
   PermissionsGuard → check product.create permission
   
   ▼

3. Controller (Phase 2)
   ProductController.create()
   - Extract tenant context
   - Extract user info
   - Validate DTO
   
   ▼

4. Service Layer (Phase 2)
   ProductService.create()
   - Check organization access (Phase 1)
   - Validate product type
   - Verify category belongs to organization
   - Verify units exist in tenant
   - Check SKU/barcode uniqueness
   - Create product in database
   
   ▼

5. Audit (Phase 0)
   AuditService.record()
   - Log PRODUCT_CREATED event
   - Store tenantId, userId, timestamp, newValues
   
   ▼

6. Response
   201 Created
   { id, code, name, productType, ..., version: 1 }
```

## Access Control Layers

```
┌─────────────────────────────────────────────────────┐
│ Layer 1: Authentication (Phase 0)                   │
│ - JWT token validation                              │
│ - User identity verification                        │
└─────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Layer 2: Tenant Context (Phase 0)                   │
│ - Resolve tenant membership                         │
│ - Load all permissions for user                     │
└─────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Layer 3: Permission Check (Phase 0)                 │
│ - Verify permission code (e.g., product.create)     │
│ - Based on role assignments                         │
└─────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Layer 4: Organization Access (Phase 1)              │
│ - For org-scoped resources only                     │
│ - Verify explicit organization access grant         │
│ - Returns 404 if no access (not 403)                │
└─────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Layer 5: Business Validation (Phase 2)              │
│ - Entity-specific rules                             │
│ - Uniqueness checks                                 │
│ - Referential integrity                             │
└─────────────────────────────────────────────────────┘
```

## Validation Strategy

### Database Level (Prisma Schema)
- Unique constraints: `(tenantId, code)`, `(organizationId, code)`
- Foreign key constraints
- Indexes for performance
- NOT NULL constraints

### Service Level (TypeScript)
- Business rule validation
- Cross-entity checks
- Cycle detection
- Deactivation guards
- SKU/barcode uniqueness (cross-organization)

### DTO Level (class-validator)
- Required field validation
- Type validation
- Format validation
- String length limits

## Error Handling Pattern

```typescript
// All errors extend AppError (Phase 0)
try {
  await service.create(...);
} catch (error) {
  if (error instanceof ValidationAppError) {
    // 400 Bad Request
  } else if (error instanceof ConflictAppError) {
    // 409 Conflict
  } else if (error instanceof NotFoundAppError) {
    // 404 Not Found
  } else if (error instanceof ConcurrencyConflictError) {
    // 409 Conflict (stale version)
  }
  // AllExceptionsFilter handles mapping to HTTP responses
}
```

## Testing Strategy

### Unit Tests (Phase 0)
- Money/decimal precision
- Business logic isolation

### E2E Tests (Phases 0, 1, 2)
- **Phase 0:** 12 tests - Foundation + document framework
- **Phase 1:** 19 tests - Organization structure + access
- **Phase 2:** 19 tests - Product catalog + validation
- **Total:** 50 E2E tests + 3 unit tests = 53 tests

### Test Database
- Real PostgreSQL instance (not mocked)
- Runs in Docker via docker-compose
- Fresh state for each test suite

## Performance Considerations

### Indexing Strategy
```sql
-- Units of Measure
CREATE INDEX idx_units_tenant_active ON units_of_measure(tenant_id, active);
CREATE UNIQUE INDEX uq_units_tenant_code ON units_of_measure(tenant_id, code);

-- Product Categories
CREATE INDEX idx_categories_org_active ON product_categories(organization_id, active);
CREATE INDEX idx_categories_parent ON product_categories(organization_id, parent_category_id);
CREATE UNIQUE INDEX uq_categories_org_code ON product_categories(organization_id, code);

-- Products
CREATE INDEX idx_products_org_active ON products(organization_id, active);
CREATE INDEX idx_products_category ON products(organization_id, category_id);
CREATE INDEX idx_products_sku ON products(tenant_id, sku);
CREATE INDEX idx_products_barcode ON products(tenant_id, barcode);
CREATE UNIQUE INDEX uq_products_org_code ON products(organization_id, code);
```

### Query Optimization
- List queries include only active records by default
- Search uses indexed columns (code, name, SKU, barcode)
- Category descendants uses iterative approach (not recursive SQL)
- Proper eager loading with Prisma includes

## Audit Trail

Every mutation records:
```typescript
{
  tenantId: string,
  eventType: 'PRODUCT_CREATED' | 'PRODUCT_UPDATED' | 'PRODUCT_DEACTIVATED',
  entityType: 'Product',
  entityId: string,
  action: 'CREATE' | 'UPDATE' | 'DEACTIVATE',
  userId: string,
  timestamp: DateTime,
  newValues: { ... }, // Changed fields only
  metadata?: { ... }
}
```

## Integration Points for Future Phases

### Phase 3 (Counterparty + Pricing)
- `ProductService.search()` for document line pickers
- Product categories for price list hierarchies
- SKU/barcode for quick product lookup
- Product.baseUnit for pricing per unit

### Phase 10 (Inventory)
- `Product.trackInventory` flag
- `Product.allowNegativeStock` flag
- `Product.productType` to distinguish goods from services
- Warehouse → Product relationships

### Phase 11 (Manufacturing)
- `ProductType.SET` for product bundles
- Weight/volume for material planning
- Categories for production scheduling
- Product structure for bill of materials

---

## Summary

Phase 2 provides a **clean, testable, and extensible** product catalog foundation that:
- Reuses 100% of Phase 0/1 infrastructure
- Maintains consistent patterns across all layers
- Includes comprehensive validation and error handling
- Provides proper access control and audit trails
- Ready for immediate use in Phase 3+
