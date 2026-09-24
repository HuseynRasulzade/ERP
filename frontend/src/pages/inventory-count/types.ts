export interface InventoryCountScope {
  id: string;
  includeExclude: string;
  warehouseId: string | null;
  locationId: string | null;
  productId: string | null;
  productGroupId: string | null;
  batchId: string | null;
  serialId: string | null;
  ownershipType: string | null;
  qualityStatus: string | null;
}

export interface InventoryCountPlan {
  id: string;
  number: string | null;
  planDate: string;
  countType: string;
  reason: string | null;
  status: string;
  blindCountEnabled: boolean;
  freezePolicy: string;
  version: number;
  // Present on the detail (`get`) response; absent on the list response.
  scopes?: InventoryCountScope[];
  sessions?: InventoryCountSession[];
}

export interface InventoryCountSession {
  id: string;
  inventoryCountPlanId: string;
  sessionNumber: string | null;
  status: string;
  freezePolicy: string;
  blindCount: boolean;
  snapshotAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  version: number;
  sheets?: InventoryCountSheet[];
}

export interface InventoryCountSheet {
  id: string;
  sheetNumber: string | null;
  warehouseId: string;
  locationId: string | null;
  status: string;
  assignedUserId: string | null;
  sequence: number;
}

export interface InventoryCountEntrySerial {
  id: string;
  serialNumber: string;
}

export interface InventoryCountEntry {
  id: string;
  warehouseId: string;
  locationId: string | null;
  productId: string;
  batchId: string | null;
  ownershipType: string;
  qualityStatus: string;
  unitId: string;
  countedQuantity: string;
  baseQuantity: string;
  countedAt: string;
  entryMethod: string;
  entryVersion: number;
  notes: string | null;
  serials: InventoryCountEntrySerial[];
}

export const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'neutral',
  READY: 'ok',
  ACTIVE: 'ok',
  SNAPSHOT_CREATED: 'ok',
  COUNTING: 'warn',
  RECOUNT_REQUIRED: 'warn',
  UNDER_REVIEW: 'warn',
  PENDING_APPROVAL: 'warn',
  APPROVED: 'ok',
  POSTED: 'ok',
  RECONCILED: 'ok',
  CLOSED: 'neutral',
  CANCELLED: 'bad',
  IN_PROGRESS: 'warn',
  COMPLETED: 'ok',
};

export function statusBadgeClass(status: string) {
  return `badge badge-generic-${STATUS_CLASS[status] ?? 'neutral'}`;
}
