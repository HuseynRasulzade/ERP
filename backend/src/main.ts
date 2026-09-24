import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  // CORS_ORIGIN as a comma-separated allowlist locks this down for
  // production; unset (dev default) reflects the request's own origin,
  // matching this app's previous wide-open `enableCors()` behavior.
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : true });

  // Request validation is authoritative server-side (section 38/39) —
  // unknown fields are stripped, not silently accepted; validation failures
  // become a stable VALIDATION_ERROR via AllExceptionsFilter.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Phase 0 foundation API listening on :${port}`);
}

bootstrap();
