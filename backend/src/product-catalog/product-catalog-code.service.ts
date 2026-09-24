import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ProductCatalogCodeEntityType = 'PARENT_CATEGORY' | 'CATEGORY';

/**
 * Auto-generates immutable, collision-safe codes for product-catalog
 * category tables (e.g. "UK-0001", "K-0001").
 *
 * Deliberately separate from NumberSequence/NumberingService (section 15):
 * that system is tenant-scoped and always stamps a year into the formatted
 * number, which doesn't fit these plain incrementing codes, and these codes
 * are organization-scoped to match `@@unique([organizationId, code])` on
 * ProductParentCategory/ProductCategory.
 *
 * Concurrency safety mirrors NumberingService: a single atomic
 * `UPDATE ... RETURNING` against the counter row takes a row lock for the
 * duration of the statement, so concurrent allocators serialize on that row
 * instead of racing on a `SELECT MAX + 1` read.
 */
@Injectable()
export class ProductCatalogCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async allocate(organizationId: string, entityType: ProductCatalogCodeEntityType, prefix: string): Promise<string> {
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO product_catalog_code_counters (organization_id, entity_type, next_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (organization_id, entity_type) DO NOTHING`,
        organizationId,
        entityType,
      );

      const rows = await tx.$queryRawUnsafe<{ allocated: bigint }[]>(
        `UPDATE product_catalog_code_counters
         SET next_number = next_number + 1
         WHERE organization_id = $1 AND entity_type = $2
         RETURNING next_number - 1 AS allocated`,
        organizationId,
        entityType,
      );

      const padded = rows[0].allocated.toString().padStart(4, '0');
      return `${prefix}-${padded}`;
    });
  }
}
