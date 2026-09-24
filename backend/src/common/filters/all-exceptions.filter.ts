import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AppError, ErrorCode } from '../errors/app-error';
import { RequestContextService } from '../context/request-context.service';

/**
 * Never expose raw database errors or stack traces to end users (section 37).
 * Translates AppError, Nest's HttpException, Prisma errors, and anything
 * unexpected into one stable envelope shape.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const requestId = this.requestContext.requestId;
    const correlationId = this.requestContext.correlationId;

    if (exception instanceof AppError) {
      response.status(exception.httpStatus).json({
        code: exception.code,
        message: exception.message,
        fieldErrors: exception.fieldErrors,
        requestId,
        correlationId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : ((body as any)?.message ?? exception.message);
      response.status(status).json({
        code: status === HttpStatus.UNAUTHORIZED ? ErrorCode.UNAUTHENTICATED : 'HTTP_ERROR',
        message: Array.isArray(message) ? message.join(', ') : message,
        fieldErrors: Array.isArray(message)
          ? { validation: message }
          : undefined,
        requestId,
        correlationId,
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Unique constraint violation, FK violation, etc. Never leak the raw
      // SQL/constraint name — map to a stable conflict code.
      this.logger.warn(`Prisma error ${exception.code}: ${exception.message}`);
      response.status(HttpStatus.CONFLICT).json({
        code: ErrorCode.CONFLICT,
        message: 'The operation could not be completed due to a data conflict',
        requestId,
        correlationId,
      });
      return;
    }

    // Database exclusion constraints (e.g. no overlapping ACTIVE accounting
    // policy versions) surface from Prisma as an "unknown" request error
    // carrying SQLSTATE 23P01 — the concurrent loser of a race the service
    // check could not see. That is a data conflict, not a server fault.
    if (
      exception instanceof Prisma.PrismaClientUnknownRequestError &&
      /23P01|exclusion constraint/i.test(exception.message)
    ) {
      this.logger.warn(`Exclusion constraint violation: ${exception.message}`);
      response.status(HttpStatus.CONFLICT).json({
        code: ErrorCode.CONFLICT,
        message: 'The operation could not be completed due to a data conflict',
        requestId,
        correlationId,
      });
      return;
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
      correlationId,
    });
  }
}
