import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { CounterpartyDocument } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Document upload/list/download/delete for a contract OR one of its
 * amendments (spec section 7) — one implementation, parameterized by
 * `ownerType`/`ownerId`, used both on ContractDetailPage (for the
 * contract itself) and inside each amendment card. */
export function DocumentManager({ orgId, ownerType, ownerId }: { orgId: string; ownerType: 'CONTRACT' | 'CONTRACT_AMENDMENT'; ownerId: string }) {
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();
  const [docs, setDocs] = useState<CounterpartyDocument[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.get<CounterpartyDocument[]>(
        `/organizations/${orgId}/counterparty-documents?ownerType=${ownerType}&ownerId=${ownerId}`,
      );
      setDocs(list);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, ownerType, ownerId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      showError(new Error('Choose a file first'));
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('ownerType', ownerType);
      formData.append('ownerId', ownerId);
      if (notes) formData.append('notes', notes);
      formData.append('file', file);
      await api.upload(`/organizations/${orgId}/counterparty-documents`, formData);
      showSuccess(t.toast.createdItem(file.name));
      setNotes('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const download = async (doc: CounterpartyDocument) => {
    try {
      const blob = await api.downloadBlob(`/organizations/${orgId}/counterparty-documents/${doc.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      showError(err);
    }
  };

  const remove = async (doc: CounterpartyDocument) => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/counterparty-documents/${doc.id}/delete`, {});
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h4>{t.contract.documents}</h4>
      {hasPermission('contract.document.manage') && (
        <div className="inline-form">
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
          <input placeholder={t.counterparty.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="button" className="primary" disabled={busy} onClick={upload}>{t.contract.uploadDocument}</button>
        </div>
      )}
      <p className="panel-note">{t.contract.allowedFileHint}</p>
      {docs.length === 0 ? (
        <p className="panel-note">{t.contract.noDocumentsYet}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.contract.fileName}</th><th>{t.contract.fileType}</th><th>{t.contract.fileSize}</th>
              <th>{t.contract.docVersion}</th><th>{t.contract.uploadedAt}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.fileName}</td>
                <td>{d.fileType}</td>
                <td className="numeric">{formatSize(d.fileSize)}</td>
                <td className="numeric">{d.documentVersion}</td>
                <td>{d.uploadedAt?.slice(0, 10)}</td>
                <td>
                  <button className="small" onClick={() => download(d)}>{t.contract.download}</button>
                  {hasPermission('contract.document.manage') && (
                    <button className="small danger" disabled={busy} onClick={() => remove(d)}>{t.contract.delete}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
