import { Module } from '@nestjs/common';
import { SalesDocumentsModule } from '../sales-documents/sales-documents.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { PrintFormsController } from './print-forms.controller';

@Module({
  imports: [SalesDocumentsModule, ProcurementModule, TreasuryModule],
  controllers: [PrintFormsController],
})
export class PrintFormsModule {}
