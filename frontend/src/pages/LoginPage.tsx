import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../i18n/LocaleContext';
import { LanguageSwitch } from '../components/LanguageSwitch';

const DEMO_EMAIL = 'demo@ccs-erp.az';
const DEMO_PASSWORD = 'Demo1234!';

export function LoginPage() {
  const { login } = useAuth();
  const { showError } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const signIn = async (loginEmail: string, loginPassword: string) => {
    setSubmitting(true);
    try {
      await login(loginEmail, loginPassword);
      navigate('/sales-orders');
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(email, password);
  };

  // Seeded by backend/prisma/seed-demo-account.ts (npm run demo:seed).
  const onDemo = () => {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    void signIn(DEMO_EMAIL, DEMO_PASSWORD);
  };

  return (
    <div className="auth-page">
      <div style={{ position: 'absolute', top: 20, right: 24 }}>
        <LanguageSwitch />
      </div>
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <span className="logo-mark">E</span>
          <strong>{t.brand}</strong>
        </div>
        <h1>{t.auth.signIn}</h1>
        <label>
          {t.auth.email}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t.auth.password}
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? t.auth.signingIn : t.auth.signIn}
        </button>
        <button type="button" className="ghost" disabled={submitting} onClick={onDemo}>
          {t.auth.tryDemo}
        </button>
        <p className="auth-switch">{t.auth.demoHint}</p>
        <p className="auth-switch">
          {t.auth.noAccount} <Link to="/register">{t.auth.register}</Link>
        </p>
      </form>
    </div>
  );
}
