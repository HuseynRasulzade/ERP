/**
 * Idempotent seed script (section 54/55): running it twice must never
 * produce duplicates. Seeds:
 *   - core currencies (AZN, USD, EUR, GBP, RUB)
 *   - all core Phase 0 permission codes
 *   - the default system "Tenant Administrator" role (granted every
 *     permission that exists at seed time)
 *   - the enumeration foundation (EnumType/EnumValue + AZ/EN translations)
 */
import { PrismaClient } from '@prisma/client';
import {
  SEED_CURRENCIES,
  SEED_ENUM_TYPES,
  SEED_PERMISSIONS,
  SYSTEM_ROLE_TENANT_ADMIN,
} from '../src/seed/seed-data';

const prisma = new PrismaClient();

async function seedCurrencies() {
  for (const currency of SEED_CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      create: currency,
      update: currency,
    });
  }
  console.log(`Seeded ${SEED_CURRENCIES.length} currencies`);
}

async function seedPermissions() {
  for (const permission of SEED_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      create: permission,
      update: { module: permission.module, description: permission.description },
    });
  }
  console.log(`Seeded ${SEED_PERMISSIONS.length} permissions`);
}

async function seedTenantAdminRole() {
  const allPermissions = await prisma.permission.findMany();

  // Prisma's compound-unique `where` cannot carry a null value for a
  // nullable column, so the system-scoped role (tenantId = null) is
  // upserted manually via findFirst + create/update.
  const existingRole = await prisma.role.findFirst({
    where: { tenantId: null, code: SYSTEM_ROLE_TENANT_ADMIN },
  });
  const role = existingRole
    ? existingRole
    : await prisma.role.create({
        data: {
          tenantId: null,
          code: SYSTEM_ROLE_TENANT_ADMIN,
          name: 'Tenant Administrator',
          description: 'Full administrative access within a single tenant',
          isSystem: true,
        },
      });

  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  console.log(`Seeded system role ${SYSTEM_ROLE_TENANT_ADMIN} with ${allPermissions.length} permissions`);
}

async function seedEnums() {
  for (const [typeCode, values] of Object.entries(SEED_ENUM_TYPES)) {
    const enumType = await prisma.enumType.upsert({
      where: { code: typeCode },
      create: { code: typeCode },
      update: {},
    });

    for (const [index, value] of values.entries()) {
      const enumValue = await prisma.enumValue.upsert({
        where: { enumTypeId_code: { enumTypeId: enumType.id, code: value.code } },
        create: { enumTypeId: enumType.id, code: value.code, sortOrder: index },
        update: { sortOrder: index },
      });

      for (const [locale, label] of Object.entries(value.labels)) {
        await prisma.enumValueTranslation.upsert({
          where: { enumValueId_locale: { enumValueId: enumValue.id, locale } },
          create: { enumValueId: enumValue.id, locale, label },
          update: { label },
        });
      }
    }
  }
  console.log(`Seeded ${Object.keys(SEED_ENUM_TYPES).length} enum types`);
}

async function main() {
  await seedCurrencies();
  await seedPermissions();
  await seedTenantAdminRole();
  await seedEnums();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
