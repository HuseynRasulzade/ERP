import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../i18n/LocaleContext';
import { LanguageSwitch } from '../components/LanguageSwitch';

export function RegisterPage() {
  const { register } = useAuth();
  const { showError } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(email, password, displayName);
      navigate('/tenants/new');
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
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
        <h1>{t.auth.createAccount}</h1>
        <label>
          {t.auth.displayName}
          <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          {t.auth.email}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t.auth.password}
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? t.auth.creating : t.auth.createAccount}
        </button>
        <p className="auth-switch">
          {t.auth.haveAccount} <Link to="/login">{t.auth.signIn}</Link>
        </p>
      </form>
    </div>
  );
}
