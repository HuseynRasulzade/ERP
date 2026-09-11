import { DocListPage } from '../docs/DocListPage';
import { DocDetailPage } from '../docs/DocDetailPage';
import type { DocKind } from '../docs/DocKind';
import { useLocale } from '../../i18n/LocaleContext';

function useGoodsReceiptKind(): DocKind {
  const { t } = useLocale();
  return {
    title: t.nav.goodsReceipts,
    singular: 'goods receipt',
    basePath: 'goods-receipts',
    routePrefix: 'goods-receipts',
    docType: 'GOODS_RECEIPT',
    viewPerm: 'purchase_execution.view',
    createPerm: 'purchase_execution.create',
    counterpartyTypes: ['SUPPLIER', 'BOTH'],
    counterpartyLabel: t.common.supplier,
    showPrice: true,
    showTax: false,
    showLineWarehouse: true,
    headerWarehouse: true,
    priceHint: 'informational',
    extraFields: [
      {
        key: 'operationType',
        label: 'Operation type',
        type: 'select-static',
        options: [
          { value: 'PURCHASE_FROM_SUPPLIER', label: 'Purchase from supplier' },
          { value: 'CONSIGNMENT_RECEIPT', label: 'Consignment receipt' },
          { value: 'IMPORT_RECEIPT', label: 'Import receipt' },
          { value: 'RECEIPT_WITHOUT_INVOICE', label: 'Receipt without invoice' },
          { value: 'OTHER_RECEIPT', label: 'Other' },
        ],
      },
      { key: 'supplierDocumentNumber', label: 'Supplier document number', type: 'text' },
    ],
    createBasedOnTargets: [
      { docType: 'PURCHASE_INVOICE', routePrefix: 'purchase-invoices', label: 'Create invoice' },
      { docType: 'PURCHASE_RETURN', routePrefix: 'purchase-returns', label: 'Create return' },
    ],
    emptyHint: 'No goods receipts yet — receive against a confirmed purchase order, or create one directly.',
    headerDisplayFields: [
      { key: 'operationType', label: 'Operation type' },
      { key: 'supplierDocumentNumber', label: 'Supplier document number' },
    ],
  };
}

export function GoodsReceiptListPage() {
  return <DocListPage kind={useGoodsReceiptKind()} />;
}

export function GoodsReceiptDetailPage() {
  return <DocDetailPage kind={useGoodsReceiptKind()} />;
}
