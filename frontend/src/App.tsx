import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import './App.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { OrganizationProvider } from './context/OrganizationContext';
import { LocaleProvider } from './i18n/LocaleContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { NewTenantPage } from './pages/NewTenantPage';
import { PeriodsPage } from './pages/PeriodsPage';
import { RolesPage } from './pages/RolesPage';
import { AuditPage } from './pages/AuditPage';
import { MembersPage } from './pages/MembersPage';
import { OrganizationsPage } from './pages/org/OrganizationsPage';
import { OrganizationDetailPage } from './pages/org/OrganizationDetailPage';
import { SalesDocumentListPage } from './pages/sales/SalesDocumentListPage';
import { SalesDocumentDetailPage } from './pages/sales/SalesDocumentDetailPage';

// Phase 6 — Sales Pre-Order
import { CustomerRequestListPage, CustomerRequestDetailPage } from './pages/preorder/CustomerRequestPage';
import { CommercialOfferListPage, CommercialOfferDetailPage } from './pages/preorder/CommercialOfferPage';

// Phase 7 — Sales Execution
import { ShipmentListPage, ShipmentDetailPage } from './pages/execution/ShipmentPage';
import { SalesReturnListPage, SalesReturnDetailPage } from './pages/execution/SalesReturnPage';

// Phase 8 — Procurement
import { PurchaseRequirementListPage, PurchaseRequirementDetailPage } from './pages/procurement/PurchaseRequirementPage';
import { PurchaseOrderListPage, PurchaseOrderDetailPage } from './pages/procurement/PurchaseOrderPage';
import { SupplierProductCodePage } from './pages/procurement/SupplierProductCodePage';

// Phase 9 — Purchase Execution
import { GoodsReceiptListPage, GoodsReceiptDetailPage } from './pages/purchasing/GoodsReceiptPage';
import { PurchaseInvoiceListPage, PurchaseInvoiceDetailPage } from './pages/purchasing/PurchaseInvoicePage';
import { PurchaseReturnListPage, PurchaseReturnDetailPage } from './pages/purchasing/PurchaseReturnPage';
import { AdditionalPurchaseCostListPage, AdditionalPurchaseCostDetailPage } from './pages/purchasing/AdditionalPurchaseCostPage';
import { PurchaseReportsPage } from './pages/purchasing/PurchaseReportsPage';

// Phase 10 — Warehouse / Stock Engine
import {
  WarehouseTransferListPage,
  WarehouseTransferDetailPage,
  InternalConsumptionListPage,
  InternalConsumptionDetailPage,
  InventoryAdjustmentListPage,
  InventoryAdjustmentDetailPage,
  InventoryStatusTransferListPage,
  InventoryStatusTransferDetailPage,
} from './pages/warehouse/WarehouseInventoryPages';
import { ProductCatalogPage } from './pages/catalog/ProductCatalogPage';
import { CounterpartyListPage } from './pages/counterparties/CounterpartyListPage';
import { CounterpartyDetailPage } from './pages/counterparties/CounterpartyDetailPage';
import { ContractDetailPage } from './pages/counterparties/ContractDetailPage';

// Accounting Core / Financial Reports
import { ChartOfAccountsPage } from './pages/accounting/ChartOfAccountsPage';
import { TrialBalancePage } from './pages/accounting/TrialBalancePage';
import { GeneralLedgerPage } from './pages/accounting/GeneralLedgerPage';
import { ManualJournalPage } from './pages/accounting/ManualJournalPage';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-page-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/tenants/new"
        element={
          <RequireAuth>
            <NewTenantPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/sales-orders" element={<SalesDocumentListPage kind="order" />} />
        <Route path="/sales-orders/:id" element={<SalesDocumentDetailPage kind="order" />} />
        <Route path="/sales-invoices" element={<SalesDocumentListPage kind="invoice" />} />
        <Route path="/sales-invoices/:id" element={<SalesDocumentDetailPage kind="invoice" />} />

        <Route path="/customer-requests" element={<CustomerRequestListPage />} />
        <Route path="/customer-requests/:id" element={<CustomerRequestDetailPage />} />
        <Route path="/commercial-offers" element={<CommercialOfferListPage />} />
        <Route path="/commercial-offers/:id" element={<CommercialOfferDetailPage />} />

        <Route path="/shipments" element={<ShipmentListPage />} />
        <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
        <Route path="/sales-returns" element={<SalesReturnListPage />} />
        <Route path="/sales-returns/:id" element={<SalesReturnDetailPage />} />

        <Route path="/purchase-requirements" element={<PurchaseRequirementListPage />} />
        <Route path="/purchase-requirements/:id" element={<PurchaseRequirementDetailPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrderListPage />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="/supplier-product-codes" element={<SupplierProductCodePage />} />

        <Route path="/goods-receipts" element={<GoodsReceiptListPage />} />
        <Route path="/goods-receipts/:id" element={<GoodsReceiptDetailPage />} />
        <Route path="/purchase-invoices" element={<PurchaseInvoiceListPage />} />
        <Route path="/purchase-invoices/:id" element={<PurchaseInvoiceDetailPage />} />
        <Route path="/purchase-returns" element={<PurchaseReturnListPage />} />
        <Route path="/purchase-returns/:id" element={<PurchaseReturnDetailPage />} />
        <Route path="/additional-costs" element={<AdditionalPurchaseCostListPage />} />
        <Route path="/additional-costs/:id" element={<AdditionalPurchaseCostDetailPage />} />
        <Route path="/purchase-reports" element={<PurchaseReportsPage />} />

        <Route path="/warehouse-transfers" element={<WarehouseTransferListPage />} />
        <Route path="/warehouse-transfers/:id" element={<WarehouseTransferDetailPage />} />
        <Route path="/internal-consumptions" element={<InternalConsumptionListPage />} />
        <Route path="/internal-consumptions/:id" element={<InternalConsumptionDetailPage />} />
        <Route path="/inventory-adjustments" element={<InventoryAdjustmentListPage />} />
        <Route path="/inventory-adjustments/:id" element={<InventoryAdjustmentDetailPage />} />
        <Route path="/inventory-status-transfers" element={<InventoryStatusTransferListPage />} />
        <Route path="/inventory-status-transfers/:id" element={<InventoryStatusTransferDetailPage />} />

        <Route path="/product-catalog" element={<ProductCatalogPage />} />

        <Route path="/counterparties" element={<CounterpartyListPage />} />
        <Route path="/counterparties/:id" element={<CounterpartyDetailPage />} />
        <Route path="/counterparties/:id/contracts/:contractId" element={<ContractDetailPage />} />

        <Route path="/chart-of-accounts" element={<ChartOfAccountsPage />} />
        <Route path="/trial-balance" element={<TrialBalancePage />} />
        <Route path="/general-ledger" element={<GeneralLedgerPage />} />
        <Route path="/manual-journal" element={<ManualJournalPage />} />

        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/organizations/:id/*" element={<OrganizationDetailPage />} />
        <Route path="/periods" element={<PeriodsPage />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/members" element={<MembersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/sales-orders" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <LocaleProvider>
        <ToastProvider>
          <AuthProvider>
            <OrganizationProvider>
              <AppRoutes />
            </OrganizationProvider>
          </AuthProvider>
        </ToastProvider>
      </LocaleProvider>
    </BrowserRouter>
  );
}
