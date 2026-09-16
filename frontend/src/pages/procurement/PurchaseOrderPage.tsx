import { DocListPage } from '../docs/DocListPage';
import { DocDetailPage } from '../docs/DocDetailPage';
import { HoldsPanel } from '../docs/HoldsPanel';
import { CreateContractFromPOPanel } from '../counterparties/CreateContractFromPOPanel';
import type { DocKind } from '../docs/DocKind';
import { useLocale } from '../../i18n/LocaleContext';
import { useOrganization } from '../../context/OrganizationContext';

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
    editLinesPerm: 'purchase.order.edit',
    approvePerm: 'purchase.order.approve',
    rejectPerm: 'purchase.order.reject',
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
    requirementPicker: {
      queryPath: 'procurement/open-requirements',
      createEndpoint: 'purchase-orders/from-requirements',
      label: t.procurement.baseOnRequirements,
      helpText: t.procurement.baseOnRequirementsHint,
    },
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
  const { currentOrganizationId } = useOrganization();
  return (
    <DocDetailPage
      kind={kind}
      renderExtras={(doc) => (
        <>
          <HoldsPanel docBasePath="purchase-orders" docId={doc.id} releaseBasePath="purchase-order-holds" holdTypes={['APPROVAL', 'SUPPLIER', 'PRICE', 'BUDGET', 'MANUAL', 'COMPLIANCE']} permission="purchase.order_hold.manage" />
          {currentOrganizationId && <CreateContractFromPOPanel orgId={currentOrganizationId} doc={doc} />}
        </>
      )}
    />
  );
}
