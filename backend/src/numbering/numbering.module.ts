import { Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { NumberingController } from './numbering.controller';

@Module({
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
