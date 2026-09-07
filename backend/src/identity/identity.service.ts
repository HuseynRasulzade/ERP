import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError } from '../common/errors/app-error';

/**
 * System users, independent of tenant membership (section 5). Tenant
 * authorization (roles/permissions) is never encoded on User itself.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(params: { email: string; password: string; displayName: string; locale?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: params.email } });
    if (existing) {
      throw new ConflictAppError('A user with this email already exists');
    }

    const passwordHash = await argon2.hash(params.password);

    return this.prisma.user.create({
      data: {
        email: params.email,
        passwordHash,
        displayName: params.displayName,
        locale: params.locale ?? 'az-AZ',
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundAppError('User', id);
    return user;
  }

  async verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return argon2.verify(passwordHash, plain);
  }

  async touchLastLogin(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  async listMemberships(userId: string) {
    return this.prisma.tenantMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { tenant: true },
    });
  }
}
