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
import * as argon2 from 'argon2';
import {
  DEMO_DEPARTMENT_CODE,
  DEMO_ORG_CODE,
  DEMO_TENANT_CODE,
  SEED_APPROVAL_ROLES,
  SEED_CURRENCIES,
  SEED_DEMO_USERS,
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

/** Approval workflow MVP demo data (docs/APPROVALS.md): a demo tenant/org/
 * department plus curated tenant-scoped roles and named test users, so
 * warehouse_user/finance_user/accounting_user/department_head/
 * sales_manager/auditor can be logged in as directly to exercise
 * role-based visibility and the approval chain end to end. */
async function seedDemoTenantOrgDepartment() {
  const azn = await prisma.currency.findUnique({ where: { code: 'AZN' } });

  const tenant = await prisma.tenant.upsert({
    where: { code: DEMO_TENANT_CODE },
    create: { code: DEMO_TENANT_CODE, name: 'Acme corp', baseCurrencyId: azn?.id },
    update: {},
  });

  const existingOrg = await prisma.organization.findFirst({ where: { tenantId: tenant.id, code: DEMO_ORG_CODE } });
  const org = existingOrg
    ? existingOrg
    : await prisma.organization.create({
        data: { tenantId: tenant.id, code: DEMO_ORG_CODE, name: 'Sinteks', baseCurrencyId: azn?.id },
      });

  const existingDept = await prisma.department.findFirst({ where: { organizationId: org.id, code: DEMO_DEPARTMENT_CODE } });
  const department = existingDept
    ? existingDept
    : await prisma.department.create({
        data: { tenantId: tenant.id, organizationId: org.id, code: DEMO_DEPARTMENT_CODE, name: 'Procurement' },
      });

  console.log(`Seeded demo tenant ${DEMO_TENANT_CODE} / org ${DEMO_ORG_CODE} / department ${DEMO_DEPARTMENT_CODE}`);
  return { tenant, org, department };
}

async function seedApprovalRoles(tenantId: string) {
  const allPermissions = await prisma.permission.findMany();
  const permissionByCode = new Map(allPermissions.map((p) => [p.code, p]));

  for (const role of SEED_APPROVAL_ROLES) {
    const existing = await prisma.role.findFirst({ where: { tenantId, code: role.code } });
    const roleRow = existing
      ? existing
      : await prisma.role.create({ data: { tenantId, code: role.code, name: role.name } });

    const permissionIds = role.permissions.map((code) => permissionByCode.get(code)?.id).filter((id): id is string => !!id);
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: roleRow.id, permissionId })),
      skipDuplicates: true,
    });
  }
  console.log(`Seeded ${SEED_APPROVAL_ROLES.length} approval-workflow roles`);
}

async function seedDemoUsers(tenantId: string, organizationId: string, departmentId: string) {
  for (const demoUser of SEED_DEMO_USERS) {
    const passwordHash = await argon2.hash(demoUser.password);
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      create: { email: demoUser.email, passwordHash, displayName: demoUser.displayName },
      update: {},
    });

    const existingMembership = await prisma.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    const membership = existingMembership
      ? existingMembership
      : await prisma.tenantMembership.create({ data: { tenantId, userId: user.id } });

    const role = await prisma.role.findFirst({ where: { tenantId, code: demoUser.roleCode } });
    if (role) {
      await prisma.membershipRole.upsert({
        where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
        create: { membershipId: membership.id, roleId: role.id },
        update: {},
      });
    }

    await prisma.organizationAccess.upsert({
      where: { tenantMembershipId_organizationId: { tenantMembershipId: membership.id, organizationId } },
      create: { tenantMembershipId: membership.id, organizationId, accessLevel: 'FULL', departmentId: demoUser.departmentCode ? departmentId : undefined },
      update: { departmentId: demoUser.departmentCode ? departmentId : undefined },
    });
  }
  console.log(`Seeded ${SEED_DEMO_USERS.length} demo users`);
}

async function main() {
  await seedCurrencies();
  await seedPermissions();
  await seedTenantAdminRole();
  await seedEnums();

  const { tenant, org, department } = await seedDemoTenantOrgDepartment();
  await seedApprovalRoles(tenant.id);
  await seedDemoUsers(tenant.id, org.id, department.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
