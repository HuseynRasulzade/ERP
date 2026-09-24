import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PermissionCodes as P } from '../rbac/permission-codes';
import { BulkHireDto, BulkTransferDto, CreateHireDto, CreateRehireDto, CreateTerminationDto, CreateTransferDto, HrDocActionDto } from './dto/hr.dto';
import { HrCtx, HrRequestContext } from './hr-context.decorator';
import { HrDocType } from './hr.constants';
import { HrDocumentLifecycleService } from './hr-document-lifecycle.service';
import { HireService } from './hire.service';
import { EmployeeTransferService } from './employee-transfer.service';
import { TerminationService } from './termination.service';
import { HrSecurityService } from './hr-security.service';
import { PermissionDeniedError } from '../common/errors/app-error';

/**
 * Hire / Rehire / Transfer / Termination documents (spec 19, 24, 43, 48,
 * 64-66, 78, 84/85, 112). POST endpoints accept an optional
 * `Idempotency-Key` header (Phase 0 IdempotencyService) on top of the
 * built-in idempotent re-post (a POSTED document replays its result).
 */
@Controller('hr')
export class HrDocumentsController {
  constructor(
    private readonly hires: HireService,
    private readonly transfers: EmployeeTransferService,
    private readonly terminations: TerminationService,
    private readonly lifecycle: HrDocumentLifecycleService,
    private readonly idempotency: IdempotencyService,
    private readonly security: HrSecurityService,
  ) {}

  private idem<T>(c: HrRequestContext, key: string | undefined, operation: string, payload: unknown, run: () => Promise<T>): Promise<T> {
    const exec = async () => JSON.parse(JSON.stringify(await run())) as T;
    return key ? this.idempotency.withIdempotency(c.tenantId, key, operation, payload, exec) : exec();
  }

  // ------------------------------------------------------------ hires

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('hires')
  listHires(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('status') status?: string, @Query('isRehire') isRehire?: string, @Query('employeeId') employeeId?: string) {
    return this.hires.list(c.tenantId, c.membershipId, { organizationId, status, isRehire, employeeId });
  }

  @RequirePermissions(P.HR_HIRE_CREATE)
  @Post('hires')
  createHire(@HrCtx() c: HrRequestContext, @Body() dto: CreateHireDto, @Headers('idempotency-key') key?: string) {
    return this.idem(c, key, 'HR_HIRE_CREATE', dto, () => this.hires.create(c.tenantId, c.membershipId, c.userId, dto));
  }

  @RequirePermissions(P.HR_HIRE_CREATE, P.HR_HIRE_POST)
  @Post('hires/bulk')
  bulkHire(@HrCtx() c: HrRequestContext, @Body() dto: BulkHireDto) {
    return this.hires.bulk(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('hires/:id')
  getHire(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.hires.get(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Post('hires/:id/preview')
  previewHire(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.hires.preview(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_HIRE_POST)
  @Post('hires/:id/post')
  postHire(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: HrDocActionDto, @Headers('idempotency-key') key?: string) {
    return this.idem(c, key, 'HR_HIRE_POST', { id }, () => this.hires.post(c.tenantId, c.membershipId, c.userId, id, dto.expectedVersion));
  }

  @RequirePermissions(P.HR_DOCUMENT_REVERSE)
  @Post('hires/:id/reverse')
  reverseHire(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: HrDocActionDto) {
    return this.hires.reverse(c.tenantId, c.membershipId, c.userId, id, dto.reason);
  }

  @RequirePermissions(P.HR_HIRE_CREATE)
  @Post('rehires')
  createRehire(@HrCtx() c: HrRequestContext, @Body() dto: CreateRehireDto) {
    return this.hires.createRehire(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_HIRE_POST)
  @Post('rehires/:id/post')
  postRehire(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: HrDocActionDto, @Headers('idempotency-key') key?: string) {
    return this.idem(c, key, 'HR_REHIRE_POST', { id }, () => this.hires.post(c.tenantId, c.membershipId, c.userId, id, dto.expectedVersion));
  }

  // ------------------------------------------------------------ transfers

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('transfers')
  listTransfers(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('status') status?: string, @Query('employmentId') employmentId?: string, @Query('batchNumber') batchNumber?: string) {
    return this.transfers.list(c.tenantId, c.membershipId, { organizationId, status, employmentId, batchNumber });
  }

  @RequirePermissions(P.HR_TRANSFER_CREATE)
  @Post('transfers')
  createTransfer(@HrCtx() c: HrRequestContext, @Body() dto: CreateTransferDto, @Headers('idempotency-key') key?: string) {
    return this.idem(c, key, 'HR_TRANSFER_CREATE', dto, () => this.transfers.create(c.tenantId, c.membershipId, c.userId, dto));
  }

  @RequirePermissions(P.HR_TRANSFER_CREATE, P.HR_TRANSFER_POST)
  @Post('transfers/bulk')
  bulkTransfer(@HrCtx() c: HrRequestContext, @Body() dto: BulkTransferDto) {
    return this.transfers.bulk(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('transfers/:id')
  getTransfer(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.transfers.get(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Post('transfers/:id/preview')
  previewTransfer(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.transfers.preview(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_TRANSFER_POST)
  @Post('transfers/:id/post')
  postTransfer(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: HrDocActionDto, @Headers('idempotency-key') key?: string) {
    return this.idem(c, key, 'HR_TRANSFER_POST', { id }, () => this.transfers.post(c.tenantId, c.membershipId, c.userId, id, dto.expectedVersion));
  }

  @RequirePermissions(P.HR_DOCUMENT_REVERSE)
  @Post('transfers/:id/reverse')
  reverseTransfer(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: HrDocActionDto) {
    return this.transfers.reverse(c.tenantId, c.membershipId, c.userId, id, dto.reason);
  }

  // ------------------------------------------------------------ terminations

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('terminations')
  listTerminations(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('status') status?: string, @Query('employmentId') employmentId?: string) {
    return this.terminations.list(c.tenantId, c.membershipId, { organizationId, status, employmentId });
  }

  @RequirePermissions(P.HR_TERMINATE_CREATE)
  @Post('terminations')
  createTermination(@HrCtx() c: HrRequestContext, @Body() dto: CreateTerminationDto, @Headers('idempotency-key') key?: string) {
    return this.idem(c, key, 'HR_TERMINATION_CREATE', dto, () => this.terminations.create(c.tenantId, c.membershipId, c.userId, dto));
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('terminations/:id')
  getTermination(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.terminations.get(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Post('terminations/:id/preview')
  previewTermination(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.terminations.preview(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_TERMINATE_POST)
  @Post('terminations/:id/post')
  postTermination(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: HrDocActionDto, @Headers('idempotency-key') key?: string) {
    return this.idem(c, key, 'HR_TERMINATION_POST', { id }, () => this.terminations.post(c.tenantId, c.membershipId, c.userId, id, dto.expectedVersion));
  }

  @RequirePermissions(P.HR_DOCUMENT_REVERSE)
  @Post('terminations/:id/reverse')
  reverseTermination(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: HrDocActionDto) {
    return this.terminations.reverse(c.tenantId, c.membershipId, c.userId, id, dto.reason);
  }

  // ------------------------------------------------------------ shared lifecycle

  private target(kind: string) {
    switch (kind) {
      case 'hires':
        return { model: 'hireDocument' as const, entity: HrDocType.HIRE, createPerm: P.HR_HIRE_CREATE, get: (c: HrRequestContext, id: string) => this.hires.get(c.tenantId, c.membershipId, id) };
      case 'transfers':
        return { model: 'employeeTransfer' as const, entity: HrDocType.TRANSFER, createPerm: P.HR_TRANSFER_CREATE, get: (c: HrRequestContext, id: string) => this.transfers.get(c.tenantId, c.membershipId, id) };
      default:
        return { model: 'terminationDocument' as const, entity: HrDocType.TERMINATION, createPerm: P.HR_TERMINATE_CREATE, get: (c: HrRequestContext, id: string) => this.terminations.get(c.tenantId, c.membershipId, id) };
    }
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Post(':kind(hires|transfers|terminations)/:id/submit')
  async submit(@HrCtx() c: HrRequestContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: HrDocActionDto) {
    const t = this.target(kind);
    if (!this.security.can(t.createPerm)) throw new PermissionDeniedError(t.createPerm);
    await t.get(c, id);
    return this.lifecycle.submit(t.model, t.entity, c.tenantId, id, c.userId, dto.expectedVersion);
  }

  @RequirePermissions(P.HR_DOCUMENT_APPROVE)
  @Post(':kind(hires|transfers|terminations)/:id/approve')
  async approve(@HrCtx() c: HrRequestContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: HrDocActionDto) {
    const t = this.target(kind);
    await t.get(c, id);
    return this.lifecycle.approve(t.model, t.entity, c.tenantId, id, c.userId, dto.expectedVersion);
  }

  @RequirePermissions(P.HR_DOCUMENT_APPROVE)
  @Post(':kind(hires|transfers|terminations)/:id/reject')
  async reject(@HrCtx() c: HrRequestContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: HrDocActionDto) {
    const t = this.target(kind);
    await t.get(c, id);
    return this.lifecycle.reject(t.model, t.entity, c.tenantId, id, c.userId, dto.reason);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Post(':kind(hires|transfers|terminations)/:id/cancel')
  async cancel(@HrCtx() c: HrRequestContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: HrDocActionDto) {
    const t = this.target(kind);
    if (!this.security.can(t.createPerm)) throw new PermissionDeniedError(t.createPerm);
    await t.get(c, id);
    return this.lifecycle.cancel(t.model, t.entity, c.tenantId, id, c.userId, dto.expectedVersion, dto.reason);
  }
}
