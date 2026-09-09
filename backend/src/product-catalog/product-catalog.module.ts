import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';

import { UnitOfMeasureService } from './unit-of-measure.service';
import { UnitOfMeasureController } from './unit-of-measure.controller';

import { ProductCategoryService } from './product-category.service';
import { ProductCategoryController } from './product-category.controller';

import { ProductService } from './product.service';
import { ProductController } from './product.controller';

/**
 * Phase 2 — Product/Nomenclature master data. Product catalog foundation:
 * units of measure, hierarchical product categories, and products.
 * Master data only — no inventory movements, pricing, or stock balances yet
 * (those are Phase 3+). Builds entirely on Phase 0/1 foundation: reuses
 * AuditService, OrganizationAccessService, PrismaService's transaction
 * helper, the AppError model, and the JWT/RBAC guard chain.
 */
@Module({
  imports: [AuditModule, OrgStructureModule],
  controllers: [
    UnitOfMeasureController,
    ProductCategoryController,
    ProductController,
  ],
  providers: [
    UnitOfMeasureService,
    ProductCategoryService,
    ProductService,
  ],
  exports: [
    UnitOfMeasureService,
    ProductCategoryService,
    ProductService,
  ],
})
export class ProductCatalogModule {}
