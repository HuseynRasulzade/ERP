import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import './App.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { OrganizationProvider } from './context/OrganizationContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { NewTenantPage } from './pages/NewTenantPage';
import { DocumentsListPage } from './pages/DocumentsListPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { PeriodsPage } from './pages/PeriodsPage';
import { RolesPage } from './pages/RolesPage';
import { AuditPage } from './pages/AuditPage';
import { MembersPage } from './pages/MembersPage';
import { OrganizationsPage } from './pages/org/OrganizationsPage';
import { OrganizationDetailPage } from './pages/org/OrganizationDetailPage';

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
        <Route path="/documents" element={<DocumentsListPage />} />
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/organizations/:id/*" element={<OrganizationDetailPage />} />
        <Route path="/periods" element={<PeriodsPage />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/members" element={<MembersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <OrganizationProvider>
            <AppRoutes />
          </OrganizationProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
