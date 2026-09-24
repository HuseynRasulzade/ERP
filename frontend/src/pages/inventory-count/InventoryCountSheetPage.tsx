import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { SalesProductRef, SalesUnitRef } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useOrganization } from '../../context/OrganizationContext';
import { useToast } from '../../context/ToastContext';
import { useLocale } from '../../i18n/LocaleContext';
import type { InventoryCountEntry, InventoryCountSheet } from './types';
import { statusBadgeClass } from './types';

interface BatchOption {
  id: string;
  batchNumber: string;
  productId: string;
}

interface CompareRow {
  entry: InventoryCountEntry;
  accountingQuantity: string;
}

export function InventoryCountSheetDetailPage() {
  const { sessionId, sheetId } = useParams<{ sessionId: string; sheetId: string }>();
  const { hasPermission } = useAuth();
  const { currentOrganizationId } = useOrganization();
  const { showError, showSuccess } = useToast();
  const { t } = useLocale();

  const [sheet, setSheet] = useState<InventoryCountSheet | null>(null);
  const [entries, setEntries] = useState<InventoryCountEntry[]>([]);
  const [products, setProducts] = useState<SalesProductRef[]>([]);
  const [units, setUnits] = useState<SalesUnitRef[]>([]);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [compare, setCompare] = useState<CompareRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [productId, setProductId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [countedQuantity, setCountedQuantity] = useState('0');
  const [serialNumbers, setSerialNumbers] = useState('');
  const [notes, setNotes] = useState('');

  const orgId = currentOrganizationId;

  const load = useCallback(async () => {
    if (!sessionId || !sheetId || !orgId) return;
    try {
      const [sheets, es, prods, uoms] = await Promise.all([
        api.get<InventoryCountSheet[]>(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets`),
        api.get<InventoryCountEntry[]>(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`),
        api.get<SalesProductRef[]>(`/organizations/${orgId}/products`).catch(() => []),
        api.get<SalesUnitRef[]>('/units-of-measure').catch(() => []),
      ]);
      setSheet(sheets.find((s) => s.id === sheetId) ?? null);
      setEntries(es);
      setProducts(prods);
      setUnits(uoms);
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sheetId, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!orgId || !productId) {
      setBatches([]);
      return;
    }
    api
      .get<BatchOption[]>(`/organizations/${orgId}/inventory-reports/batches?productId=${productId}`)
      .catch(() => [])
      .then((all) => setBatches(all));
    const product = products.find((p) => p.id === productId);
    if (product) setUnitId(product.baseUnitId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, productId]);

  if (!orgId) return <p className="panel-note">{t.common.selectOrganization}</p>;
  if (!sheet) return <p className="panel-note">{t.common.loading}</p>;

  const submitEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (!productId || !unitId) return;
    setBusy(true);
    try {
      const serials = serialNumbers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await api.post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`, {
        warehouseId: sheet.warehouseId,
        locationId: sheet.locationId ?? undefined,
        productId,
        batchId: batchId || undefined,
        unitId,
        countedQuantity: Number(countedQuantity),
        serialNumbers: serials.length > 0 ? serials : undefined,
        notes: notes || undefined,
      });
      showSuccess('Count entry saved');
      setProductId('');
      setBatchId('');
      setCountedQuantity('0');
      setSerialNumbers('');
      setNotes('');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const completeSheet = async () => {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/complete`);
      showSuccess('Sheet completed');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const loadCompare = async () => {
    setBusy(true);
    try {
      const rows = await api.get<CompareRow[]>(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries/compare`);
      setCompare(rows);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8);
  const unitSymbol = (id: string) => units.find((u) => u.id === id)?.symbol ?? '';

  return (
    <div>
      <Link to={`/inventory-count/sessions/${sessionId}`} className="link-muted">
        ← Back to session
      </Link>

      <div className="page-header">
        <div>
          <h1>{sheet.sheetNumber ?? sheet.id.slice(0, 8)}</h1>
          <div className="badge-row">
            <span className={statusBadgeClass(sheet.status)}>{sheet.status}</span>
            <span className="badge">Warehouse {sheet.warehouseId.slice(0, 8)}</span>
            {sheet.locationId && <span className="badge">Location {sheet.locationId.slice(0, 8)}</span>}
          </div>
        </div>
        <div className="actions">
          {hasPermission('inventory_count.view_accounting_quantity') && (
            <button onClick={loadCompare} disabled={busy}>
              Compare to book qty
            </button>
          )}
          {sheet.status !== 'COMPLETED' && hasPermission('inventory_count.enter') && (
            <button className="primary" onClick={completeSheet} disabled={busy || entries.length === 0}>
              Complete sheet
            </button>
          )}
        </div>
      </div>

      {sheet.status !== 'COMPLETED' && hasPermission('inventory_count.enter') && (
        <form className="card" onSubmit={submitEntry}>
          <h3 style={{ marginTop: 0 }}>Blind count entry</h3>
          <p className="panel-note" style={{ marginTop: 0 }}>
            The book (accounting) quantity is never shown here — that is the point of a blind count.
          </p>
          <div className="form-grid">
            <label>
              {t.common.product}
              <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="" disabled>
                  {t.common.select}
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Batch (if applicable)
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">—</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.common.unit}
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                <option value="" disabled>
                  {t.common.select}
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.symbol})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Counted quantity
              <input type="number" step="any" min="0" value={countedQuantity} onChange={(e) => setCountedQuantity(e.target.value)} required />
            </label>
            <label>
              Serial numbers (comma-separated, if serial-tracked)
              <input value={serialNumbers} onChange={(e) => setSerialNumbers(e.target.value)} placeholder="SN-001, SN-002" />
            </label>
            <label>
              {t.common.description}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t.common.saving : 'Save count'}
            </button>
          </div>
        </form>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Counted so far</h3>
        {entries.length === 0 ? (
          <p className="panel-note">Nothing counted on this sheet yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.product}</th>
                <th>Batch</th>
                <th>Counted qty</th>
                <th>Base qty</th>
                <th>Serials</th>
                <th>Version</th>
                <th>Counted at</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{productName(e.productId)}</td>
                  <td>{e.batchId ? e.batchId.slice(0, 8) : '—'}</td>
                  <td>
                    {e.countedQuantity} {unitSymbol(e.unitId)}
                  </td>
                  <td>{e.baseQuantity}</td>
                  <td>{e.serials.length > 0 ? e.serials.map((s) => s.serialNumber).join(', ') : '—'}</td>
                  <td>{e.entryVersion > 1 ? <span className="badge badge-generic-warn">v{e.entryVersion} (corrected)</span> : 'v1'}</td>
                  <td>{new Date(e.countedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {compare && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Supervisor view — counted vs. book quantity</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.common.product}</th>
                <th>Counted</th>
                <th>Book (accounting)</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((row) => {
                const diff = Number(row.entry.baseQuantity) - Number(row.accountingQuantity);
                return (
                  <tr key={row.entry.id}>
                    <td>{productName(row.entry.productId)}</td>
                    <td>{row.entry.baseQuantity}</td>
                    <td>{row.accountingQuantity}</td>
                    <td>
                      <span className={`badge badge-generic-${diff === 0 ? 'ok' : diff > 0 ? 'warn' : 'bad'}`}>{diff > 0 ? `+${diff}` : diff}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
