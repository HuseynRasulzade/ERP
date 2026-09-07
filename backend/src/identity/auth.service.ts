import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';
import { AppError, ErrorCode, UnauthenticatedError } from '../common/errors/app-error';
import { HttpStatus } from '@nestjs/common';

export interface JwtPayload {
  sub: string;
  email: string;
  isSystemAdmin: boolean;
}

/**
 * Section 39: safe password/auth handling. Passwords are hashed with
 * argon2id (never stored/logged in plain text); access tokens are short
 * lived; refresh tokens are opaque, stored only as a SHA-256 hash, and
 * rotated on every use so a stolen refresh token cannot be replayed after
 * the legitimate client refreshes.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(params: { email: string; password: string; displayName: string; locale?: string }) {
    const user = await this.identity.createUser(params);
    return this.issueTokens(user.id, user.email, user.isSystemAdmin);
  }

  async login(email: string, password: string) {
    const user = await this.identity.findByEmail(email);
    if (!user) throw new UnauthenticatedError('Invalid credentials');
    if (user.status !== 'ACTIVE') throw new UnauthenticatedError('Account is disabled');

    const valid = await this.identity.verifyPassword(user.passwordHash, password);
    if (!valid) throw new UnauthenticatedError('Invalid credentials');

    await this.identity.touchLastLogin(user.id);
    return this.issueTokens(user.id, user.email, user.isSystemAdmin);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        'Refresh token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Rotate: revoke the used token and issue a brand new pair.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(record.user.id, record.user.email, record.user.isSystemAdmin);
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, email: string, isSystemAdmin: boolean) {
    const payload: JwtPayload = { sub: userId, email, isSystemAdmin };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL'),
    });

    const refreshToken = crypto.randomBytes(48).toString('hex');
    const refreshTtlMs = this.parseTtlMs(this.config.get<string>('JWT_REFRESH_TTL') ?? '7d');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    return { accessToken, refreshToken, userId, email, isSystemAdmin };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private parseTtlMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const unit = match[2];
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000;
    return value * unitMs;
  }
}
