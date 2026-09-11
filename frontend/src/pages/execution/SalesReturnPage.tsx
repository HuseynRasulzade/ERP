import { ReturnListPage, ReturnDetailPage } from '../docs/ReturnPage';
import type { ReturnKind } from '../docs/ReturnPage';
import { useLocale } from '../../i18n/LocaleContext';

function useSalesReturnKind(): ReturnKind {
  const { t } = useLocale();
  return {
    title: t.nav.salesReturns,
    basePath: 'sales-returns',
    routePrefix: 'sales-returns',
    docType: 'SALES_RETURN',
    viewPerm: 'sales.return.view',
    createPerm: 'sales.return.create',
    counterpartyLabel: t.common.customer,
    hasOriginalPrice: false,
    sourceFields: [{ key: 'originalSalesInvoiceId', label: 'Original sales invoice id' }],
    reasonOptions: ['DAMAGED', 'WRONG_ITEM', 'QUALITY_ISSUE', 'CUSTOMER_CHANGED_MIND', 'OTHER'],
  };
}

export function SalesReturnListPage() {
  return <ReturnListPage kind={useSalesReturnKind()} />;
}

export function SalesReturnDetailPage() {
  return <ReturnDetailPage kind={useSalesReturnKind()} />;
}
