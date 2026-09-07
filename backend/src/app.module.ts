import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';

import { PrismaModule } from './prisma/prisma.module';
import { RequestContextModule } from './common/context/request-context.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantContextGuard } from './common/guards/tenant-context.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

import { IdentityModule } from './identity/identity.module';
import { TenantModule } from './tenant/tenant.module';
import { RbacModule } from './rbac/rbac.module';
import { CurrencyModule } from './currency/currency.module';
import { NumberingModule } from './numbering/numbering.module';
import { PeriodModule } from './period/period.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { DocumentFrameworkModule } from './document-framework/document-framework.module';
import { DocumentLinkModule } from './document-link/document-link.module';
import { FoundationTestDocumentModule } from './foundation-test-document/foundation-test-document.module';
import { OrgStructureModule } from './org-structure/org-structure.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RequestContextModule,
    PrismaModule,

    // Platform foundation modules (Phase 0)
    IdentityModule,
    TenantModule,
    RbacModule,
    CurrencyModule,
    NumberingModule,
    PeriodModule,
    AuditModule,
    SettingsModule,
    IdempotencyModule,
    DocumentFrameworkModule,
    DocumentLinkModule,

    // Phase 1 — Organization & Business Structure
    OrgStructureModule,

    // Demo/reference document proving the framework end to end
    FoundationTestDocumentModule,
  ],
  controllers: [AppController],
  providers: [
    // Guard order matters: authenticate -> resolve tenant context -> check
    // permissions. Nest runs APP_GUARD providers in registration order.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
