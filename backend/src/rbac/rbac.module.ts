import { Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { PermissionsController, RolesController } from './rbac.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [PermissionsController, RolesController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
