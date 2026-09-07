import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdentityService } from './identity.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthController, UsersController } from './identity.controller';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL') },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [IdentityService, AuthService, JwtStrategy],
  exports: [IdentityService, AuthService],
})
export class IdentityModule {}
