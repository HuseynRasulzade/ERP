import { InventoryDocListPage } from './InventoryDocListPage';
import { InventoryDocDetailPage } from './InventoryDocDetailPage';
import { WAREHOUSE_TRANSFER_KIND, INTERNAL_CONSUMPTION_KIND, INVENTORY_ADJUSTMENT_KIND, INVENTORY_STATUS_TRANSFER_KIND } from './InventoryDocKind';

export function WarehouseTransferListPage() {
  return <InventoryDocListPage kind={WAREHOUSE_TRANSFER_KIND} />;
}
export function WarehouseTransferDetailPage() {
  return <InventoryDocDetailPage kind={WAREHOUSE_TRANSFER_KIND} />;
}

export function InternalConsumptionListPage() {
  return <InventoryDocListPage kind={INTERNAL_CONSUMPTION_KIND} />;
}
export function InternalConsumptionDetailPage() {
  return <InventoryDocDetailPage kind={INTERNAL_CONSUMPTION_KIND} />;
}

export function InventoryAdjustmentListPage() {
  return <InventoryDocListPage kind={INVENTORY_ADJUSTMENT_KIND} />;
}
export function InventoryAdjustmentDetailPage() {
  return <InventoryDocDetailPage kind={INVENTORY_ADJUSTMENT_KIND} />;
}

export function InventoryStatusTransferListPage() {
  return <InventoryDocListPage kind={INVENTORY_STATUS_TRANSFER_KIND} />;
}
export function InventoryStatusTransferDetailPage() {
  return <InventoryDocDetailPage kind={INVENTORY_STATUS_TRANSFER_KIND} />;
}
