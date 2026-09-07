import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

interface Toast {
  id: number;
  kind: 'error' | 'info' | 'success';
  message: string;
  code?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  showError: (err: unknown) => void;
  showSuccess: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/** Human-readable copy for the error codes the frontend needs to react to
 * distinctly (section 14/21/62): a concurrency conflict or a closed-period
 * rejection should never just look like a generic failure. */
const CODE_MESSAGES: Record<string, string> = {
  CONCURRENCY_CONFLICT: 'This record was changed by someone else. Refresh and try again.',
  PERIOD_CLOSED: 'The accounting period for this date is closed. Ask an administrator to reopen it.',
  PERMISSION_DENIED: "You don't have permission to do that.",
  DOCUMENT_ALREADY_POSTED: 'This document is already posted.',
  DOCUMENT_NOT_POSTED: "This document isn't posted yet.",
  TENANT_CONTEXT_REQUIRED: 'Select a tenant first.',
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((t) => [...t, { ...toast, id }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const showError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        push({ kind: 'error', message: CODE_MESSAGES[err.code] ?? err.message, code: err.code });
      } else if (err instanceof Error) {
        push({ kind: 'error', message: err.message });
      } else {
        push({ kind: 'error', message: 'Something went wrong' });
      }
    },
    [push],
  );

  const showSuccess = useCallback((message: string) => push({ kind: 'success', message }), [push]);

  return (
    <ToastContext.Provider value={{ toasts, showError, showSuccess, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
