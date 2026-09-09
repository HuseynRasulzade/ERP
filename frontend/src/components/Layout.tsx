import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ToastHost } from './ToastHost';

/** Section 50/51: reusable tenant selector + current-tenant display +
 * permission-aware navigation. Hiding a link here is a convenience only —
 * the backend guard is what actually enforces access. */
export function Layout() {
  const { user, tenants, currentTenantId, hasPermission, selectTenant, logout } = useAuth();
  const navigate = useNavigate();

  const currentTenant = tenants.find((t) => t.tenantId === currentTenantId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">ERP Platform</div>

        <div className="tenant-selector">
          <select
            value={currentTenantId ?? ''}
            onChange={(e) => {
              selectTenant(e.target.value);
              navigate('/documents');
            }}
          >
            <option value="" disabled>
              Select tenant…
            </option>
            {tenants.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.tenantName} ({t.tenantCode})
              </option>
            ))}
          </select>
          <NavLink to="/tenants/new" className="link-muted">
            + New tenant
          </NavLink>
        </div>

        <div className="user-menu">
          <span>{user?.displayName}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="app-body">
        <nav className="sidenav">
          <NavLink to="/documents">Documents</NavLink>
          {hasPermission('sales_order.view') && <NavLink to="/sales-orders">Sales Orders</NavLink>}
          {hasPermission('sales_invoice.view') && <NavLink to="/sales-invoices">Sales Invoices</NavLink>}
          {hasPermission('organization.view') && <NavLink to="/organizations">Organizations</NavLink>}
          {hasPermission('periods.view') && <NavLink to="/periods">Periods</NavLink>}
          {hasPermission('core.roles.view') && <NavLink to="/roles">Roles &amp; Permissions</NavLink>}
          {hasPermission('audit.view') && <NavLink to="/audit">Audit Log</NavLink>}
          {hasPermission('core.users.view') && <NavLink to="/members">Members</NavLink>}
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
