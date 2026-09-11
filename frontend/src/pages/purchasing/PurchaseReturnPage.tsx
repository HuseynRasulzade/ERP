import { ReturnListPage, ReturnDetailPage } from '../docs/ReturnPage';
import type { ReturnKind } from '../docs/ReturnPage';
import { useLocale } from '../../i18n/LocaleContext';

function usePurchaseReturnKind(): ReturnKind {
  const { t } = useLocale();
  return {
    title: t.nav.purchaseReturns,
    basePath: 'purchase-returns',
    routePrefix: 'purchase-returns',
    docType: 'PURCHASE_RETURN',
    viewPerm: 'purchase_execution.view',
    createPerm: 'purchase_execution.return',
    counterpartyLabel: t.common.supplier,
    hasOriginalPrice: true,
    sourceFields: [
      { key: 'originalGoodsReceiptId', label: 'Original goods receipt id' },
      { key: 'originalPurchaseInvoiceId', label: 'Original purchase invoice id' },
    ],
    reasonOptions: ['DAMAGED', 'WRONG_ITEM', 'QUALITY_ISSUE', 'EXCESS_DELIVERY', 'EXPIRED', 'CONTRACT_CANCELLATION', 'OTHER'],
  };
}

export function PurchaseReturnListPage() {
  return <ReturnListPage kind={usePurchaseReturnKind()} />;
}

export function PurchaseReturnDetailPage() {
  return <ReturnDetailPage kind={usePurchaseReturnKind()} />;
}
