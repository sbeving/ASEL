import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastCtx {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value = useMemo<ToastCtx>(
    () => ({
      push,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              'pointer-events-auto max-w-md w-full rounded-lg border px-4 py-3 shadow-lg text-sm',
              t.kind === 'success' && 'bg-emerald-50 border-emerald-200 text-emerald-900',
              t.kind === 'error' && 'bg-rose-50 border-rose-200 text-rose-900',
              t.kind === 'info' && 'bg-slate-50 border-slate-200 text-slate-900',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
