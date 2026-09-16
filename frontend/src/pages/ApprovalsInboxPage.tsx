import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useOrganization } from '../context/OrganizationContext';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../i18n/LocaleContext';

interface PendingApproval {
  documentType: string;
  documentId: string;
  stepType: string;
  sequence: number;
  createdAt: string;
  organizationId: string | null;
  documentNumber: string | null;
}

const ROUTE_BY_DOC_TYPE: Record<string, string> = {
  SALES_ORDER: 'sales-orders',
  SALES_INVOICE: 'sales-invoices',
  PURCHASE_REQUIREMENT: 'purchase-requirements',
  PURCHASE_ORDER: 'purchase-orders',
  GOODS_RECEIPT: 'goods-receipts',
  PURCHASE_INVOICE: 'purchase-invoices',
  PAYMENT_ORDER: 'payment-orders',
};

/** "Bildiriş/tapşırıq paneli" — a single cross-document-type list of every
 * approval step the current user may act on right now (GET /approval-
 * steps/pending). Deliberately just a list with links to each document's
 * own detail page (where the real approve/reject action already lives via
 * ApprovalStepsPanel) — not a duplicate decision UI here. */
export function ApprovalsInboxPage() {
  const { organizations } = useOrganization();
  const { showError } = useToast();
  const { t } = useLocale();
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<PendingApproval[]>('/approval-steps/pending');
      setItems(rows);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgName = (id: string | null) => organizations.find((o) => o.id === id)?.name ?? id ?? '—';
  const stepLabel = (s: string) => (t.status.approvalStepType as Record<string, string>)[s] ?? s;

  return (
    <div>
      <div className="page-header">
        <h1>{t.nav.approvalsInbox}</h1>
      </div>

      {loading ? (
        <p className="panel-note">{t.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="panel-note">{t.approvalsInbox.empty}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.approvalsInbox.documentType}</th>
              <th>{t.common.number}</th>
              <th>{t.approvalsInbox.step}</th>
              <th>{t.common.organization}</th>
              <th>{t.approvalsInbox.filedAt}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const route = ROUTE_BY_DOC_TYPE[i.documentType];
              return (
                <tr key={`${i.documentType}-${i.documentId}`}>
                  <td>{i.documentType}</td>
                  <td>{i.documentNumber ?? i.documentId.slice(0, 8)}</td>
                  <td>{stepLabel(i.stepType)}</td>
                  <td>{orgName(i.organizationId)}</td>
                  <td>{new Date(i.createdAt).toLocaleString()}</td>
                  <td>
                    {route ? (
                      <Link to={`/${route}/${i.documentId}`}>{t.approvalsInbox.review}</Link>
                    ) : (
                      i.documentId.slice(0, 8)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
