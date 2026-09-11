export interface InventoryFieldOption {
  value: string;
  label: string;
}

export interface InventoryField {
  key: string;
  label: string;
  type: 'select-static' | 'text' | 'date' | 'number';
  options?: InventoryFieldOption[];
  required?: boolean;
}

/** Config a single generic list/detail page pair reads to render any of
 * the four Phase 10 "quantity document" kinds (WarehouseTransfer,
 * InternalConsumption, InventoryAdjustment, InventoryStatusTransfer)
 * without duplicating the page per kind — the DocKind pattern used for
 * priced documents (Sales/Purchase Order, Invoice, Goods Receipt,
 * Shipment) doesn't fit here: these documents have no counterparty/
 * price/tax, and WarehouseTransfer needs two warehouses, not one. */
export interface InventoryDocKind {
  title: string;
  singular: string;
  basePath: string; // relative to /organizations/:orgId/
  routePrefix: string;
  docType: string; // backend document-framework type string
  viewPerm: string;
  createPerm: string;
  warehouseShape: 'single' | 'transfer';
  headerFields?: InventoryField[];
  lineFields?: InventoryField[]; // beyond product/unit/quantity
  emptyHint: string;
}

const STOCK_STATUSES: InventoryFieldOption[] = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'QUARANTINE', label: 'Quarantine' },
  { value: 'QUALITY_CONTROL', label: 'Quality Control' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'EXPIRED', label: 'Expired' },
];

export const WAREHOUSE_TRANSFER_KIND: InventoryDocKind = {
  title: 'Warehouse Transfers',
  singular: 'Warehouse Transfer',
  basePath: 'warehouse-transfers',
  routePrefix: 'warehouse-transfers',
  docType: 'WAREHOUSE_TRANSFER',
  viewPerm: 'inventory.view',
  createPerm: 'inventory.transfer.create',
  warehouseShape: 'transfer',
  headerFields: [
    {
      key: 'transferType',
      label: 'Transfer Type',
      type: 'select-static',
      required: true,
      options: [
        { value: 'INSTANT', label: 'Instant' },
        { value: 'TWO_STEP', label: 'Two-Step (ship then receive)' },
        { value: 'INTERNAL_LOCATION_TRANSFER', label: 'Internal Location Transfer' },
      ],
    },
  ],
  lineFields: [{ key: 'batchId', label: 'Batch ID', type: 'text' }],
  emptyHint: 'No warehouse transfers yet.',
};

export const INTERNAL_CONSUMPTION_KIND: InventoryDocKind = {
  title: 'Internal Consumption',
  singular: 'Internal Consumption',
  basePath: 'internal-consumptions',
  routePrefix: 'internal-consumptions',
  docType: 'INTERNAL_CONSUMPTION',
  viewPerm: 'inventory.view',
  createPerm: 'inventory.consume',
  warehouseShape: 'single',
  headerFields: [
    {
      key: 'operationType',
      label: 'Operation Type',
      type: 'select-static',
      options: [
        { value: 'OFFICE_CONSUMPTION', label: 'Office Consumption' },
        { value: 'MARKETING', label: 'Marketing' },
        { value: 'MAINTENANCE', label: 'Maintenance' },
        { value: 'PROJECT_USE', label: 'Project Use' },
        { value: 'OTHER', label: 'Other' },
      ],
    },
  ],
  lineFields: [
    { key: 'batchId', label: 'Batch ID', type: 'text' },
    { key: 'purpose', label: 'Purpose', type: 'text' },
  ],
  emptyHint: 'No internal consumption documents yet.',
};

export const INVENTORY_ADJUSTMENT_KIND: InventoryDocKind = {
  title: 'Inventory Adjustments',
  singular: 'Inventory Adjustment',
  basePath: 'inventory-adjustments',
  routePrefix: 'inventory-adjustments',
  docType: 'INVENTORY_ADJUSTMENT',
  viewPerm: 'inventory.view',
  createPerm: 'inventory.write_off',
  warehouseShape: 'single',
  headerFields: [
    {
      key: 'adjustmentType',
      label: 'Adjustment Type',
      type: 'select-static',
      required: true,
      options: [
        { value: 'WRITE_OFF', label: 'Write-Off' },
        { value: 'SURPLUS', label: 'Surplus' },
        { value: 'OPENING_BALANCE', label: 'Opening Balance' },
      ],
    },
    {
      key: 'reasonCode',
      label: 'Reason',
      type: 'select-static',
      options: [
        { value: 'DAMAGE', label: 'Damage' },
        { value: 'EXPIRY', label: 'Expiry' },
        { value: 'LOSS', label: 'Loss' },
        { value: 'THEFT', label: 'Theft' },
        { value: 'OBSOLETE', label: 'Obsolete' },
        { value: 'QUALITY_FAILURE', label: 'Quality Failure' },
        { value: 'NATURAL_LOSS', label: 'Natural Loss' },
        { value: 'MANAGEMENT_DECISION', label: 'Management Decision' },
        { value: 'OTHER', label: 'Other' },
      ],
    },
  ],
  lineFields: [
    { key: 'batchId', label: 'Batch ID', type: 'text' },
    { key: 'stockStatus', label: 'Stock Status', type: 'select-static', options: STOCK_STATUSES },
    { key: 'costReference', label: 'Cost Reference', type: 'number' },
  ],
  emptyHint: 'No inventory adjustments yet.',
};

export const INVENTORY_STATUS_TRANSFER_KIND: InventoryDocKind = {
  title: 'Inventory Status Transfers',
  singular: 'Inventory Status Transfer',
  basePath: 'inventory-status-transfers',
  routePrefix: 'inventory-status-transfers',
  docType: 'INVENTORY_STATUS_TRANSFER',
  viewPerm: 'inventory.view',
  createPerm: 'inventory.status_change',
  warehouseShape: 'single',
  lineFields: [
    { key: 'batchId', label: 'Batch ID', type: 'text' },
    { key: 'fromStockStatus', label: 'From Status', type: 'select-static', required: true, options: STOCK_STATUSES },
    { key: 'toStockStatus', label: 'To Status', type: 'select-static', required: true, options: STOCK_STATUSES },
  ],
  emptyHint: 'No inventory status transfers yet.',
};
