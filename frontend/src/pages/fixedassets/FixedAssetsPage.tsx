import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { Currency } from '../../api/types';
import { useOrganization } from '../../context/OrganizationContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface FixedAssetCategory {
  id: string;
  code: string;
  name: string;
  defaultUsefulLifeMonths: number | null;
}

interface FixedAsset {
  id: string;
  assetNumber: string;
  name: string;
  categoryId: string;
  status: string;
  initialCost: string;
  carryingAmount: string;
  usefulLifeMonths: number;
  currencyId: string;
}

const emptyCategoryForm = () => ({ code: '', name: '', defaultUsefulLifeMonths: '' });
const emptyAssetForm = () => ({
  name: '',
  categoryId: '',
  currencyId: '',
  directAmount: '',
  acquisitionDate: new Date().toISOString().slice(0, 10),
  documentDate: new Date().toISOString().slice(0, 10),
});

/** Fixed Asset register (Phase 16). Assets are always born through
 * capitalization (never a plain "create asset" row) — this page offers
 * the simplest of the three capitalization sources (`directAmount`,
 * spec-legal for a straightforward manual entry) alongside the
 * CIP-project and Expense-Claim-acquisition-candidate paths, which stay
 * backend-only for now (see docs/FIXED_ASSETS.md). */
export function FixedAssetsPage() {
  const { currentOrganizationId, organizations } = useOrganization();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();
  const [categories, setCategories] = useState<FixedAssetCategory[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm());
  const [assetForm, setAssetForm] = useState(emptyAssetForm());
  const [showCategoryForm, setShowCategoryForm] = useState(false);

  const load = async () => {
    if (!currentOrganizationId) return;
    try {
      const [cats, assetList, curr] = await Promise.all([
        api.get<FixedAssetCategory[]>(`/organizations/${currentOrganizationId}/fixed-assets/categories`),
        api.get<FixedAsset[]>(`/organizations/${currentOrganizationId}/fixed-assets`),
        api.get<Currency[]>('/currencies'),
      ]);
      setCategories(cats);
      setAssets(assetList);
      setCurrencies(curr);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId]);

  const createCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId) return;
    try {
      await api.post(`/organizations/${currentOrganizationId}/fixed-assets/categories`, {
        code: categoryForm.code,
        name: categoryForm.name,
        defaultUsefulLifeMonths: categoryForm.defaultUsefulLifeMonths ? Number(categoryForm.defaultUsefulLifeMonths) : undefined,
      });
      showSuccess('Category created');
      setCategoryForm(emptyCategoryForm());
      setShowCategoryForm(false);
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const createAsset = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId) return;
    try {
      await api.post(`/organizations/${currentOrganizationId}/fixed-assets/capitalize`, {
        name: assetForm.name,
        categoryId: assetForm.categoryId,
        currencyId: assetForm.currencyId,
        directAmount: Number(assetForm.directAmount),
        acquisitionDate: assetForm.acquisitionDate,
        documentDate: assetForm.documentDate,
        usefulLifeMonths: categories.find((c) => c.id === assetForm.categoryId)?.defaultUsefulLifeMonths ?? 60,
      });
      showSuccess('Fixed asset capitalized (draft — post it from the capitalization document to recognize it)');
      setAssetForm(emptyAssetForm());
      await load();
    } catch (err) {
      showError(err);
    }
  };

  if (organizations.length === 0) return <p className="empty-hint">Create an organization first.</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Fixed Assets</h1>
        {hasPermission('fixed_asset.create') && (
          <button onClick={() => setShowCategoryForm((v) => !v)}>{showCategoryForm ? 'Close' : '+ New category'}</button>
        )}
      </div>

      {showCategoryForm && (
        <form className="inline-form" onSubmit={createCategory}>
          <label>
            Code
            <input required value={categoryForm.code} onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })} />
          </label>
          <label>
            Name
            <input required value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} />
          </label>
          <label>
            Default useful life (months)
            <input type="number" value={categoryForm.defaultUsefulLifeMonths} onChange={(e) => setCategoryForm({ ...categoryForm, defaultUsefulLifeMonths: e.target.value })} />
          </label>
          <button type="submit">Create category</button>
        </form>
      )}

      {categories.length === 0 ? (
        <p className="empty-hint">Create a category first (e.g. "Vehicles", "Office equipment") before capitalizing an asset.</p>
      ) : (
        hasPermission('fixed_asset.accept') && (
          <div className="card">
            <h3>Capitalize a new asset</h3>
            <form className="inline-form" onSubmit={createAsset}>
              <label>
                Name
                <input required value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="e.g. Toyota Camry 2026" />
              </label>
              <label>
                Category
                <select required value={assetForm.categoryId} onChange={(e) => setAssetForm({ ...assetForm, categoryId: e.target.value })}>
                  <option value="">Select…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Currency
                <select required value={assetForm.currencyId} onChange={(e) => setAssetForm({ ...assetForm, currencyId: e.target.value })}>
                  <option value="">Select…</option>
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Acquisition cost
                <input required type="number" step="0.01" min="0.01" value={assetForm.directAmount} onChange={(e) => setAssetForm({ ...assetForm, directAmount: e.target.value })} />
              </label>
              <label>
                Acquisition date
                <input type="date" value={assetForm.acquisitionDate} onChange={(e) => setAssetForm({ ...assetForm, acquisitionDate: e.target.value })} />
              </label>
              <button type="submit" className="primary">
                Capitalize
              </button>
            </form>
            <p className="panel-note">
              This records the asset directly (no automatic GL entry — see docs/FIXED_ASSETS.md section C; the source
              purchase already posted its own GL treatment). Commissioning (moving it to ACTIVE / depreciation-eligible)
              is a separate step available on the asset's own detail page.
            </p>
          </div>
        )
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Asset #</th>
            <th>Name</th>
            <th>Category</th>
            <th>Status</th>
            <th>Initial cost</th>
            <th>Carrying amount</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>{a.assetNumber}</td>
              <td>{a.name}</td>
              <td>{categories.find((c) => c.id === a.categoryId)?.name ?? '—'}</td>
              <td>{a.status}</td>
              <td>{Number(a.initialCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td>{Number(a.carryingAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
          {assets.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-hint">
                No fixed assets yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
