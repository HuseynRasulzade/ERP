import { useLocale } from '../i18n/LocaleContext';

export function LanguageSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="lang-switch">
      <button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
        EN
      </button>
      <button className={locale === 'az' ? 'active' : ''} onClick={() => setLocale('az')}>
        AZ
      </button>
    </div>
  );
}
