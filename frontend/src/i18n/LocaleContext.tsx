import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import en from './en';
import az from './az';
import type { Translations } from './en';

export type Locale = 'en' | 'az';

const DICTIONARIES: Record<Locale, Translations> = { en, az };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translations;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function detectInitialLocale(): Locale {
  const stored = localStorage.getItem('locale');
  if (stored === 'en' || stored === 'az') return stored;
  return navigator.language?.toLowerCase().startsWith('az') ? 'az' : 'en';
}

/** Lightweight, fully-typed i18n — no external dependency. `t` is the
 * whole translation tree for the active locale, so call sites read as
 * `t.common.save` with autocomplete/type-checking rather than opaque
 * string keys. Locale persists in localStorage and is picked up once at
 * mount from the browser's language otherwise. */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = (l: Locale) => {
    localStorage.setItem('locale', l);
    setLocaleState(l);
  };

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t: DICTIONARIES[locale] }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
