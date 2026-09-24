import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

/** My Profile — the only place a user can change their own display name,
 * locale, or timezone (User.locale/timezone had no update path at all
 * before this: `PATCH /users/me` and this page close that gap). */
export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { showError, showSuccess } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [locale, setLocale] = useState(user?.locale ?? '');
  const [timezone, setTimezone] = useState(user?.timezone ?? '');
  const [busy, setBusy] = useState(false);

  if (!user) return <p className="panel-note">Loading…</p>;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/users/me', { displayName, locale: locale || undefined, timezone: timezone || undefined });
      await refreshUser();
      showSuccess('Profile updated');
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>My Profile</h1>
      </div>
      <form className="card" onSubmit={save}>
        <div className="inline-form">
          <label>Email<input value={user.email} disabled /></label>
          <label>Display name<input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        </div>
        <div className="inline-form">
          <label>Locale<input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="az-AZ" /></label>
          <label>Timezone<input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Baku" /></label>
        </div>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </div>
  );
}
