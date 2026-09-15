import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AuditActorContextService (docx spec Phase 25, sections 14-16, 90).
 * Captures a HISTORICAL display snapshot of the actor (username, role
 * context) at event time rather than only a live foreign key to the
 * user master — so a later rename/deactivation never degrades audit
 * readability (spec section 15). Session lifecycle
 * (`AuditSession`) is exposed here but not yet wired into the actual
 * login/logout controllers in this build — disclosed,
 * docs/AUDIT_TRAIL.md section C.
 */
@Injectable()
export class AuditActorContextService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshotActor(tenantId: string, userId: string, organizationId?: string): Promise<{ userId: string; username: string; roleContext?: string; organizationContext?: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const membership = organizationId ? await this.prisma.tenantMembership.findFirst({ where: { tenantId, userId, status: 'ACTIVE' }, include: { roles: { include: { role: true } } } }).catch(() => null) : null;
    return {
      userId,
      username: user?.displayName ?? user?.email ?? userId,
      roleContext: membership?.roles?.map((r) => r.role.name).join(', '),
      organizationContext: organizationId,
    };
  }

  async startSession(tenantId: string, userId: string, dto: { authenticationMethod?: string; deviceClient?: string; ipAddress?: string; userAgent?: string; application?: string; impersonatedBy?: string; elevatedPrivilege?: boolean }) {
    return this.prisma.auditSession.create({
      data: {
        tenantId,
        userId,
        authenticationMethod: dto.authenticationMethod,
        deviceClient: dto.deviceClient,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        application: dto.application,
        impersonationContext: dto.impersonatedBy ? { realActorId: dto.impersonatedBy } : undefined,
        elevatedPrivilege: dto.elevatedPrivilege ?? false,
        status: 'ACTIVE',
      },
    });
  }

  async endSession(tenantId: string, sessionId: string, status: 'LOGGED_OUT' | 'REVOKED' = 'LOGGED_OUT') {
    return this.prisma.auditSession.updateMany({ where: { id: sessionId, tenantId }, data: { logoutTime: new Date(), status } });
  }

  listUserSessions(tenantId: string, userId: string) {
    return this.prisma.auditSession.findMany({ where: { tenantId, userId }, orderBy: { loginTime: 'desc' } });
  }
}
