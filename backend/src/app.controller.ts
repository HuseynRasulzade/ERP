import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'erp-platform-phase0', time: new Date().toISOString() };
  }
}
