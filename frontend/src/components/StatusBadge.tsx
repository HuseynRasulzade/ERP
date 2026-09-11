import { useLocale } from '../i18n/LocaleContext';

/** Language-neutral status codes get a display label here — never persist a
 * translated label as the underlying value (section 52). */
export function StatusBadge({ kind, value }: { kind: 'document' | 'posting' | 'period'; value: string }) {
  const { t } = useLocale();
  const dict = kind === 'document' ? t.status.document : kind === 'posting' ? t.status.posting : t.status.period;
  const label = (dict as Record<string, string>)[value] ?? value;

  return <span className={`badge badge-${kind}-${value.toLowerCase()}`}>{label}</span>;
}
