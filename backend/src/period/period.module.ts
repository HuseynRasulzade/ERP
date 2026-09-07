import { Module } from '@nestjs/common';
import { PeriodService } from './period.service';
import { PeriodController } from './period.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [PeriodController],
  providers: [PeriodService],
  exports: [PeriodService],
})
export class PeriodModule {}
