import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// -- Purchase Requirement ----------------------------------------------------

export class RequirementLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsDateString()
  requiredByDate?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  preferredSupplierId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Present only when this line is derived from a demand source (spec
   * sections 9-11) — e.g. a SalesOrderLine. Manual requirements omit these. */
  @IsOptional()
  @IsString()
  sourceDocumentType?: string;

  @IsOptional()
  @IsString()
  sourceDocumentId?: string;

  @IsOptional()
  @IsString()
  sourceLineId?: string;
}

export class CreatePurchaseRequirementDto {
  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  requesterId?: string;

  @IsOptional()
  @IsDateString()
  requiredByDate?: string;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequirementLineItemDto)
  lines!: RequirementLineItemDto[];
}

export class UpdatePurchaseRequirementDto {
  @IsInt()
  expectedVersion!: number;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  requesterId?: string;

  @IsOptional()
  @IsDateString()
  requiredByDate?: string;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequirementLineItemDto)
  lines?: RequirementLineItemDto[];
}

// -- Purchase Order allocation-from-requirement ------------------------------

export class AllocateRequirementLineDto {
  @IsString()
  requirementLineId!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  price?: number;
}

/**
 * Bulk requirement -> PurchaseOrder creation (spec-adjacent extension):
 * combines EVERY remaining line of one or more OPEN/PARTIALLY_ORDERED
 * requirements into a single new PurchaseOrder, auto-filling
 * product/unit/quantity per line (the full remaining quantity — never a
 * partial allocation the caller has to compute) rather than requiring an
 * explicit per-line allocation like `CreatePurchaseOrderFromRequirementDto`
 * does. All requirements must share the same department — enforced
 * server-side (ProcurementPlanningService) as the authority; the frontend
 * blocks the same thing pre-submit purely for UX.
 */
export class CreatePurchaseOrderFromRequirementsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  requirementIds!: string[];

  @IsString()
  counterpartyId!: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreatePurchaseOrderFromRequirementDto {
  @IsString()
  counterpartyId!: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocateRequirementLineDto)
  lines!: AllocateRequirementLineDto[];
}

// -- Purchase Order -----------------------------------------------------------

export class PurchaseDeliveryScheduleItemDto {
  @IsDateString()
  plannedDate!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}

export class PurchaseLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  quantity!: number;

  /** Optional explicit price. When omitted, PurchasePriceResolver fills it
   * from PURCHASE price lists for this supplier. */
  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @IsOptional()
  @IsBoolean()
  isService?: boolean;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  requirementLineId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseDeliveryScheduleItemDto)
  deliverySchedule?: PurchaseDeliveryScheduleItemDto[];
}

export class CreatePurchaseOrderDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  supplierReference?: string;

  @IsOptional()
  @IsIn(['LOCAL', 'IMPORT', 'FRAME_CONTRACT', 'SPOT_PURCHASE', 'OTHER'])
  purchaseChannel?: string;

  @IsOptional()
  @IsString()
  buyerId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineItemDto)
  lines!: PurchaseLineItemDto[];
}

export class UpdatePurchaseOrderDto {
  @IsInt()
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  supplierReference?: string;

  @IsOptional()
  @IsIn(['LOCAL', 'IMPORT', 'FRAME_CONTRACT', 'SPOT_PURCHASE', 'OTHER'])
  purchaseChannel?: string;

  @IsOptional()
  @IsString()
  buyerId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineItemDto)
  lines?: PurchaseLineItemDto[];
}

export class CancelPurchaseOrderLineDto {
  @IsNumber()
  @Min(0)
  cancelQuantity!: number;
}

// -- Holds --------------------------------------------------------------------

export class PlacePurchaseOrderHoldDto {
  @IsIn(['APPROVAL', 'SUPPLIER', 'PRICE', 'BUDGET', 'MANUAL', 'COMPLIANCE'])
  holdType!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

// -- Payment schedule -----------------------------------------------------------

export class PurchasePaymentInstallmentDto {
  @IsDateString()
  dueDate!: string;

  @IsIn(['ADVANCE', 'AFTER_RECEIPT', 'AFTER_INVOICE'])
  basis!: string;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class GeneratePurchasePaymentScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchasePaymentInstallmentDto)
  installments!: PurchasePaymentInstallmentDto[];
}

// -- Supplier Product Code -----------------------------------------------------

export class UpsertSupplierProductCodeDto {
  @IsString()
  counterpartyId!: string;

  @IsString()
  productId!: string;

  @IsString()
  supplierCode!: string;

  @IsOptional()
  @IsString()
  supplierUnitId?: string;

  @IsOptional()
  @IsNumber()
  moq?: number;

  @IsOptional()
  @IsNumber()
  orderMultiple?: number;

  @IsOptional()
  @IsInt()
  leadTimeDays?: number;
}

// -- Supply Peg -----------------------------------------------------------------

export class CreateSupplyPegDto {
  @IsIn(['SALES_ORDER'])
  demandType!: string;

  @IsString()
  demandId!: string;

  @IsString()
  demandLineId!: string;

  @IsIn(['PURCHASE_ORDER'])
  supplyType!: string;

  @IsString()
  supplyId!: string;

  @IsString()
  supplyLineId!: string;

  @IsNumber()
  quantity!: number;
}
