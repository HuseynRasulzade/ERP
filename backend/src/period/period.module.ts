import { Module } from '@nestjs/common';
import { PeriodService } from './period.service';
import { PeriodController } from './period.controller';
import { PeriodReopenRequestService } from './period-reopen-request.service';
import { PeriodReopenRequestController } from './period-reopen-request.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [PeriodController, PeriodReopenRequestController],
  providers: [PeriodService, PeriodReopenRequestService],
  exports: [PeriodService],
})
export class PeriodModule {}
