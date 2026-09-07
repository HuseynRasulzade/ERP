import { useToast } from '../context/ToastContext';

export function ToastHost() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.code && <span className="toast-code">{t.code}</span>}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
