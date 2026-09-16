import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ApprovalStep } from '../../api/types';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

/** Reusable "Approval steps" panel — same card shape as the generic
 * document-links/audit panels in DocDetailPage.tsx, but usable from any
 * page (DocDetailPage-driven or bespoke, e.g. PurchaseRequirementPage)
 * since approve/reject endpoints differ per document type. */
export function ApprovalStepsPanel({
  orgId,
  documentType,
  documentId,
  approvalStatus,
  approvePerm,
  rejectPerm,
  approveEndpoint,
  rejectEndpoint,
  onChanged,
}: {
  orgId: string;
  documentType: string;
  documentId: string;
  approvalStatus?: string;
  approvePerm?: string;
  rejectPerm?: string;
  approveEndpoint: string; // relative to /organizations/:orgId/
  rejectEndpoint: string; // relative to /organizations/:orgId/
  onChanged: () => void;
}) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    const rows = await api.get<ApprovalStep[]>(`/approval-steps?documentType=${documentType}&documentId=${documentId}`).catch(() => []);
    setSteps(rows);
  }, [documentType, documentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (approvalStatus === 'NOT_REQUIRED' && steps.length === 0) return null;

  const pendingStep = steps.find((s) => s.status === 'PENDING');
  const canApprove = approvalStatus === 'PENDING' && !!pendingStep && !!approvePerm && hasPermission(approvePerm);
  const canReject = approvalStatus === 'PENDING' && !!pendingStep && !!rejectPerm && hasPermission(rejectPerm);

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !comment.trim()) {
      showError(new Error(t.common.approvalRejectReasonRequired));
      return;
    }
    setBusy(true);
    try {
      const endpoint = action === 'approve' ? approveEndpoint : rejectEndpoint;
      await api.post(`/organizations/${orgId}/${endpoint}`, { comment: comment.trim() || undefined });
      showSuccess(t.toast.documentAction(t.common.approvalStatus, action === 'approve' ? t.common.approved : t.common.rejected));
      setComment('');
      await load();
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>{t.common.approvalSteps}</h2>
      {steps.length === 0 ? (
        <p className="panel-note">{t.common.noApprovalSteps}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t.common.approvalSteps}</th>
              <th>{t.common.status}</th>
              <th>{t.common.approve}</th>
              <th>{t.common.description}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.id}>
                <td>{s.sequence}</td>
                <td>{(t.status.approvalStepType as Record<string, string>)[s.stepType] ?? s.stepType}</td>
                <td><StatusBadge kind="approvalStep" value={s.status} /></td>
                <td>{s.approvedAt ? new Date(s.approvedAt).toLocaleString() : '—'}</td>
                <td>{s.comment ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(canApprove || canReject) && (
        <div className="inline-form">
          <input
            type="text"
            placeholder={t.common.approvalComment}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {canApprove && (
            <button className="primary" disabled={busy} onClick={() => decide('approve')}>
              {t.common.approve}
            </button>
          )}
          {canReject && (
            <button className="danger" disabled={busy} onClick={() => decide('reject')}>
              {t.common.reject}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
