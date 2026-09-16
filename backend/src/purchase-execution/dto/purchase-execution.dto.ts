import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// -- Goods Receipt ------------------------------------------------------------

export class GoodsReceiptLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  supplierOrderLineId?: string;

  @IsOptional()
  @IsString()
  countryOfOrigin?: string;

  @IsOptional()
  @IsString()
  customsDeclaration?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  // Phase 10 — batch/serial capture (spec sections 19-23). `batchNumber`
  // find-or-creates a Batch for this product; `serialNumbers` is captured
  // raw and resolved into real SerialNumber rows at posting time.
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  supplierBatchNumber?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  // Requester's justification when this line's quantity exceeds the
  // source PO line's remaining quantity — mandatory in that case (see
  // GoodsReceiptService.resolveLines), otherwise ignored.
  @IsOptional()
  @IsString()
  overReceiptReason?: string;
}

export class CreateGoodsReceiptDto {
  @IsString()
  counterpartyId!: string;

  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  supplierOrderId?: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsIn(['PURCHASE_FROM_SUPPLIER', 'CONSIGNMENT_RECEIPT', 'IMPORT_RECEIPT', 'RECEIPT_WITHOUT_INVOICE', 'OTHER_RECEIPT'])
  operationType?: string;

  @IsOptional()
  @IsString()
  supplierDocumentNumber?: string;

  @IsOptional()
  @IsDateString()
  supplierDocumentDate?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineItemDto)
  lines!: GoodsReceiptLineItemDto[];
}

export class UpdateGoodsReceiptDto {
  @IsNumber()
  expectedVersion!: number;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineItemDto)
  lines?: GoodsReceiptLineItemDto[];
}

// -- Purchase Invoice -----------------------------------------------------------

export class PurchaseInvoiceLineItemDto {
  @IsOptional()
  @IsIn(['INVENTORY', 'SERVICE', 'EXPENSE', 'FIXED_ASSET', 'PREPAYMENT', 'OTHER'])
  lineType?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsNumber()
  quantity!: number;

  @IsNumber()
  price!: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  expenseAccountId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  goodsReceiptLineId?: string;

  @IsOptional()
  @IsString()
  supplierOrderLineId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreatePurchaseInvoiceDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsString()
  supplierInvoiceNumber?: string;

  @IsOptional()
  @IsDateString()
  supplierInvoiceDate?: string;

  @IsOptional()
  @IsString()
  supplierOrderId?: string;

  @IsOptional()
  @IsString()
  goodsReceiptId?: string;

  @IsOptional()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseInvoiceLineItemDto)
  lines!: PurchaseInvoiceLineItemDto[];
}

export class UpdatePurchaseInvoiceDto {
  @IsNumber()
  expectedVersion!: number;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseInvoiceLineItemDto)
  lines?: PurchaseInvoiceLineItemDto[];
}

// -- Purchase Return --------------------------------------------------------------

export class PurchaseReturnLineItemDto {
  @IsOptional()
  @IsString()
  sourceReceiptLineId?: string;

  @IsOptional()
  @IsString()
  sourceInvoiceLineId?: string;

  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  quantity!: number;

  @IsNumber()
  originalUnitPrice!: number;

  // Phase 10 — goods physically leave the warehouse back to the supplier
  // (see PurchaseReturnPostingHandler): `batchId` picks an existing
  // Batch to issue from, `serialNumbers` the specific existing serials.
  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @IsOptional()
  @IsIn(['DAMAGED', 'WRONG_ITEM', 'QUALITY_ISSUE', 'EXCESS_DELIVERY', 'EXPIRED', 'CONTRACT_CANCELLATION', 'OTHER'])
  reason?: string;
}

export class CreatePurchaseReturnDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  originalGoodsReceiptId?: string;

  @IsOptional()
  @IsString()
  originalPurchaseInvoiceId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsIn(['DAMAGED', 'WRONG_ITEM', 'QUALITY_ISSUE', 'EXCESS_DELIVERY', 'EXPIRED', 'CONTRACT_CANCELLATION', 'OTHER'])
  returnReason?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnLineItemDto)
  lines!: PurchaseReturnLineItemDto[];
}

// -- Additional Purchase Cost -----------------------------------------------------

export class AdditionalPurchaseCostTargetLineDto {
  @IsString()
  goodsReceiptLineId!: string;

  @IsOptional()
  @IsNumber()
  manualCoefficient?: number;
}

export class CreateAdditionalPurchaseCostDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsIn(['TRANSPORT', 'CUSTOMS', 'INSURANCE', 'LOADING', 'BROKER', 'FREIGHT', 'HANDLING', 'CERTIFICATION', 'OTHER'])
  costType?: string;

  @IsIn(['BY_QUANTITY', 'BY_WEIGHT', 'BY_VOLUME', 'BY_VALUE', 'EQUALLY', 'MANUAL'])
  allocationMethod!: string;

  @IsNumber()
  @Min(0.01)
  totalCost!: number;

  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdditionalPurchaseCostTargetLineDto)
  targetLines!: AdditionalPurchaseCostTargetLineDto[];
}
