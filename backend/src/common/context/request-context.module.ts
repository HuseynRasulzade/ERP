import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { v4 as uuid } from 'uuid';
import { RequestContextService } from './request-context.service';

/**
 * Every incoming request receives/propagates a request/correlation ID and,
 * once authenticated and tenant-resolved, carries the authenticated user id
 * and active tenant id through the whole call stack (services, repositories,
 * audit, logging) without threading them through every function signature.
 *
 * This is what section 4 means by "every API/business operation executes
 * inside a tenant context" and section 25 ("every incoming request should
 * receive or propagate a request/correlation ID").
 */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: any) => req.headers['x-request-id'] ?? uuid(),
        setup: (cls, req: any) => {
          cls.set('requestId', req.headers['x-request-id'] ?? cls.getId());
          cls.set('correlationId', req.headers['x-correlation-id'] ?? cls.getId());
        },
      },
    }),
  ],
})
export class RequestContextModule {}
