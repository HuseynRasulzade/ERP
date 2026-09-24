import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SEED_APPROVAL_ROLES } from '../src/seed/seed-data';

const prisma = new PrismaClient();

const TENANT_ID = 'cfed2420-9d38-43fc-8775-88544f7e3f77'; // demo2
const ORG_ID = '278bfd45-b352-423c-8a1b-ccc6f72cb4b3'; // demo-org

const SATIS_DEPARTMENT_ID = '1879e178-2e8b-46da-bdec-c7536083ff8c';

const USERS: { email: string; password: string; displayName: string; roleCode: string; departmentId?: string }[] = [
  { email: 'procurement_officer@demo2.test', password: 'Passw0rd!23', displayName: 'Procurement Officer', roleCode: 'PROCUREMENT_OFFICER' },
  { email: 'director@demo2.test', password: 'Passw0rd!23', displayName: 'Director', roleCode: 'DIRECTOR' },
  { email: 'finance_user@demo2.test', password: 'Passw0rd!23', displayName: 'Finance User', roleCode: 'FINANCE_USER' },
  { email: 'sales_manager@demo2.test', password: 'Passw0rd!23', displayName: 'Sales Manager', roleCode: 'SALES_MANAGER' },
  { email: 'warehouse_user@demo2.test', password: 'Passw0rd!23', displayName: 'Warehouse User', roleCode: 'WAREHOUSE_USER' },
  { email: 'department_head@demo2.test', password: 'Passw0rd!23', displayName: 'Department Head', roleCode: 'DEPARTMENT_HEAD', departmentId: SATIS_DEPARTMENT_ID },
];

async function main() {
  const allPermissions = await prisma.permission.findMany();
  const permissionByCode = new Map(allPermissions.map((p) => [p.code, p]));

  for (const role of SEED_APPROVAL_ROLES) {
    const existing = await prisma.role.findFirst({ where: { tenantId: TENANT_ID, code: role.code } });
    const roleRow = existing ? existing : await prisma.role.create({ data: { tenantId: TENANT_ID, code: role.code, name: role.name } });
    const permissionIds = role.permissions.map((c) => permissionByCode.get(c)?.id).filter((id): id is string => !!id);
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: roleRow.id, permissionId })),
      skipDuplicates: true,
    });
  }
  console.log(`Seeded ${SEED_APPROVAL_ROLES.length} approval roles for tenant ${TENANT_ID}`);

  for (const demoUser of USERS) {
    const passwordHash = await argon2.hash(demoUser.password);
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      create: { email: demoUser.email, passwordHash, displayName: demoUser.displayName },
      update: {},
    });

    const existingMembership = await prisma.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId: TENANT_ID, userId: user.id } } });
    const membership = existingMembership ? existingMembership : await prisma.tenantMembership.create({ data: { tenantId: TENANT_ID, userId: user.id } });

    const role = await prisma.role.findFirst({ where: { tenantId: TENANT_ID, code: demoUser.roleCode } });
    if (role) {
      await prisma.membershipRole.upsert({
        where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
        create: { membershipId: membership.id, roleId: role.id },
        update: {},
      });
    }

    await prisma.organizationAccess.upsert({
      where: { tenantMembershipId_organizationId: { tenantMembershipId: membership.id, organizationId: ORG_ID } },
      create: { tenantMembershipId: membership.id, organizationId: ORG_ID, accessLevel: 'FULL', departmentId: demoUser.departmentId },
      update: { departmentId: demoUser.departmentId },
    });

    console.log(`Seeded user ${demoUser.email} with role ${demoUser.roleCode}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
