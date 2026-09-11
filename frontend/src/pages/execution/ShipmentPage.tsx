import { DocListPage } from '../docs/DocListPage';
import { DocDetailPage } from '../docs/DocDetailPage';
import type { DocKind } from '../docs/DocKind';
import { useLocale } from '../../i18n/LocaleContext';

function useShipmentKind(): DocKind {
  const { t } = useLocale();
  return {
    title: t.nav.shipments,
    singular: 'shipment',
    basePath: 'shipments',
    routePrefix: 'shipments',
    docType: 'SHIPMENT',
    viewPerm: 'sales.shipment.view',
    createPerm: 'sales.shipment.create',
    counterpartyTypes: ['CUSTOMER', 'BOTH'],
    counterpartyLabel: t.common.customer,
    showPrice: false,
    showTax: false,
    showLineWarehouse: true,
    headerWarehouse: true,
    createBasedOnTargets: [{ docType: 'SALES_INVOICE', routePrefix: 'sales-invoices', label: 'Create invoice' }],
    emptyHint: 'No shipments yet — ship from a confirmed sales order, or create one directly.',
  };
}

export function ShipmentListPage() {
  return <DocListPage kind={useShipmentKind()} />;
}

export function ShipmentDetailPage() {
  return <DocDetailPage kind={useShipmentKind()} />;
}
