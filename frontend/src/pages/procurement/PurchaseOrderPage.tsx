import { DocListPage } from '../docs/DocListPage';
import { DocDetailPage } from '../docs/DocDetailPage';
import { HoldsPanel } from '../docs/HoldsPanel';
import type { DocKind } from '../docs/DocKind';
import { useLocale } from '../../i18n/LocaleContext';

function usePurchaseOrderKind(): DocKind {
  const { t } = useLocale();
  return {
    title: t.nav.purchaseOrders,
    singular: 'purchase order',
    basePath: 'purchase-orders',
    routePrefix: 'purchase-orders',
    docType: 'PURCHASE_ORDER',
    viewPerm: 'purchase.order.view',
    createPerm: 'purchase.order.create',
    counterpartyTypes: ['SUPPLIER', 'BOTH'],
    counterpartyLabel: t.common.supplier,
    showPrice: true,
    showTax: true,
    showLineWarehouse: true,
    headerWarehouse: true,
    priceHint: 'auto from PURCHASE price list',
    extraFields: [
      { key: 'expectedDeliveryDate', label: 'Expected delivery', type: 'date' },
      { key: 'supplierReference', label: 'Supplier reference', type: 'text' },
    ],
    createBasedOnTargets: [
      { docType: 'GOODS_RECEIPT', routePrefix: 'goods-receipts', label: 'Create receipt' },
      { docType: 'PURCHASE_INVOICE', routePrefix: 'purchase-invoices', label: 'Create invoice' },
    ],
    emptyHint: 'No purchase orders yet.',
    headerDisplayFields: [
      { key: 'expectedDeliveryDate', label: 'Expected delivery' },
      { key: 'supplierReference', label: 'Supplier reference' },
    ],
  };
}

export function PurchaseOrderListPage() {
  return <DocListPage kind={usePurchaseOrderKind()} />;
}

export function PurchaseOrderDetailPage() {
  const kind = usePurchaseOrderKind();
  return <DocDetailPage kind={kind} renderExtras={(doc) => <HoldsPanel docBasePath="purchase-orders" docId={doc.id} releaseBasePath="purchase-order-holds" holdTypes={['APPROVAL', 'SUPPLIER', 'PRICE', 'BUDGET', 'MANUAL', 'COMPLIANCE']} permission="purchase.order_hold.manage" />} />;
}
