import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { ToastHost } from './ToastHost';
import { LanguageSwitch } from './LanguageSwitch';

/** Section 50/51: reusable tenant selector + current-tenant display +
 * permission-aware navigation, grouped by business area (Core, Sales,
 * Procurement, Administration) now that the sidebar spans docx spec
 * Phases 0-9. Hiding a link here is a convenience only — the backend
 * guard is what actually enforces access. */
export function Layout() {
  const { user, tenants, currentTenantId, hasPermission, selectTenant, logout } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();

  const currentTenant = tenants.find((t) => t.tenantId === currentTenantId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo-mark">E</span>
          {t.brand}
        </div>

        <div className="tenant-selector">
          <select
            value={currentTenantId ?? ''}
            onChange={(e) => {
              selectTenant(e.target.value);
              navigate('/sales-orders');
            }}
          >
            <option value="" disabled>
              {t.auth.selectTenant}
            </option>
            {tenants.map((tn) => (
              <option key={tn.tenantId} value={tn.tenantId}>
                {tn.tenantName} ({tn.tenantCode})
              </option>
            ))}
          </select>
          <NavLink to="/tenants/new" className="link-muted">
            {t.auth.newTenant}
          </NavLink>
        </div>

        <LanguageSwitch />

        <div className="user-menu">
          <span className="user-name">{user?.displayName}</span>
          <button onClick={logout}>{t.auth.signOut}</button>
        </div>
      </header>

      <div className="app-body">
        <nav className="sidenav">
          <div className="nav-group-label">{t.nav.groupCore}</div>
          {hasPermission('product.view') && (
            <NavLink to="/product-catalog">
              <span className="nav-icon">▤</span>
              {t.nav.productCatalog}
            </NavLink>
          )}
          {hasPermission('counterparty.view') && (
            <NavLink to="/counterparties">
              <span className="nav-icon">☍</span>
              {t.nav.counterparties}
            </NavLink>
          )}

          <div className="nav-group-label">{t.nav.groupSales}</div>
          {hasPermission('sales.customer_request.view') && (
            <NavLink to="/customer-requests">
              <span className="nav-icon">✉</span>
              {t.nav.customerRequests}
            </NavLink>
          )}
          {hasPermission('sales.offer.view') && (
            <NavLink to="/commercial-offers">
              <span className="nav-icon">◈</span>
              {t.nav.commercialOffers}
            </NavLink>
          )}
          {hasPermission('sales_order.view') && (
            <NavLink to="/sales-orders">
              <span className="nav-icon">▣</span>
              {t.nav.salesOrders}
            </NavLink>
          )}
          {hasPermission('sales.shipment.view') && (
            <NavLink to="/shipments">
              <span className="nav-icon">▶</span>
              {t.nav.shipments}
            </NavLink>
          )}
          {hasPermission('sales_invoice.view') && (
            <NavLink to="/sales-invoices">
              <span className="nav-icon">▦</span>
              {t.nav.salesInvoices}
            </NavLink>
          )}
          {hasPermission('sales.return.view') && (
            <NavLink to="/sales-returns">
              <span className="nav-icon">↩</span>
              {t.nav.salesReturns}
            </NavLink>
          )}

          <div className="nav-group-label">{t.nav.groupProcurement}</div>
          {hasPermission('purchase.requirement.view') && (
            <NavLink to="/purchase-requirements">
              <span className="nav-icon">✎</span>
              {t.nav.purchaseRequirements}
            </NavLink>
          )}
          {hasPermission('purchase.order.view') && (
            <NavLink to="/purchase-orders">
              <span className="nav-icon">▣</span>
              {t.nav.purchaseOrders}
            </NavLink>
          )}
          {hasPermission('purchase.supplier_product_code.view') && (
            <NavLink to="/supplier-product-codes">
              <span className="nav-icon">#</span>
              {t.nav.supplierProductCodes}
            </NavLink>
          )}
          {hasPermission('purchase_execution.view') && (
            <NavLink to="/goods-receipts">
              <span className="nav-icon">▼</span>
              {t.nav.goodsReceipts}
            </NavLink>
          )}
          {hasPermission('purchase_execution.view') && (
            <NavLink to="/purchase-invoices">
              <span className="nav-icon">▦</span>
              {t.nav.purchaseInvoices}
            </NavLink>
          )}
          {hasPermission('purchase_execution.view') && (
            <NavLink to="/purchase-returns">
              <span className="nav-icon">↩</span>
              {t.nav.purchaseReturns}
            </NavLink>
          )}
          {hasPermission('purchase_execution.view') && (
            <NavLink to="/additional-costs">
              <span className="nav-icon">+</span>
              {t.nav.additionalCosts}
            </NavLink>
          )}
          {hasPermission('purchase_execution.view_accounting') && (
            <NavLink to="/purchase-reports">
              <span className="nav-icon">📊</span>
              {t.nav.purchaseReports}
            </NavLink>
          )}

          <div className="nav-group-label">{t.nav.groupWarehouse}</div>
          {hasPermission('inventory.view') && (
            <NavLink to="/warehouse-transfers">
              <span className="nav-icon">⇄</span>
              {t.nav.warehouseTransfers}
            </NavLink>
          )}
          {hasPermission('inventory.view') && (
            <NavLink to="/internal-consumptions">
              <span className="nav-icon">⚙</span>
              {t.nav.internalConsumptions}
            </NavLink>
          )}
          {hasPermission('inventory.view') && (
            <NavLink to="/inventory-adjustments">
              <span className="nav-icon">±</span>
              {t.nav.inventoryAdjustments}
            </NavLink>
          )}
          {hasPermission('inventory.view') && (
            <NavLink to="/inventory-status-transfers">
              <span className="nav-icon">◐</span>
              {t.nav.inventoryStatusTransfers}
            </NavLink>
          )}

          <div className="nav-group-label">{t.nav.groupAccounting}</div>
          {hasPermission('accounting.account.view') && (
            <NavLink to="/chart-of-accounts">
              <span className="nav-icon">📒</span>
              {t.nav.chartOfAccounts}
            </NavLink>
          )}
          {hasPermission('accounting.trial_balance.view') && (
            <NavLink to="/trial-balance">
              <span className="nav-icon">⚖</span>
              {t.nav.trialBalance}
            </NavLink>
          )}
          {hasPermission('accounting.general_ledger.view') && (
            <NavLink to="/general-ledger">
              <span className="nav-icon">📖</span>
              {t.nav.generalLedger}
            </NavLink>
          )}
          {hasPermission('accounting.manual_operation.view') && (
            <NavLink to="/manual-journal">
              <span className="nav-icon">✎</span>
              {t.nav.manualJournal}
            </NavLink>
          )}

          <div className="nav-group-label">{t.nav.groupTreasury}</div>
          {hasPermission('treasury.view') && (
            <NavLink to="/bank-payments">
              <span className="nav-icon">🏦</span>
              {t.nav.bankPayments}
            </NavLink>
          )}
          {hasPermission('cash.view') && (
            <NavLink to="/cash-payments">
              <span className="nav-icon">💵</span>
              {t.nav.cashPayments}
            </NavLink>
          )}
          {hasPermission('fixed_asset.view') && (
            <NavLink to="/fixed-assets">
              <span className="nav-icon">🏗</span>
              {t.nav.fixedAssets}
            </NavLink>
          )}

          <div className="nav-group-label">{t.nav.groupAdmin}</div>
          {hasPermission('organization.view') && (
            <NavLink to="/organizations">
              <span className="nav-icon">⌂</span>
              {t.nav.organizations}
            </NavLink>
          )}
          {hasPermission('periods.view') && (
            <NavLink to="/periods">
              <span className="nav-icon">◷</span>
              {t.nav.periods}
            </NavLink>
          )}
          {hasPermission('core.roles.view') && (
            <NavLink to="/roles">
              <span className="nav-icon">🛡</span>
              {t.nav.roles}
            </NavLink>
          )}
          {hasPermission('audit.view') && (
            <NavLink to="/audit">
              <span className="nav-icon">☰</span>
              {t.nav.audit}
            </NavLink>
          )}
          {hasPermission('core.users.view') && (
            <NavLink to="/members">
              <span className="nav-icon">◉</span>
              {t.nav.members}
            </NavLink>
          )}
        </nav>

        <main className="content">
          {currentTenant ? (
            <Outlet />
          ) : (
            <div className="empty-state">
              <p>Select or create a tenant to continue.</p>
            </div>
          )}
        </main>
      </div>

      <ToastHost />
    </div>
  );
}
