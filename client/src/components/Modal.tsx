import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }: Props) {
  if (!open) return null;
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl';
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/55 p-4">
      <div className={`card surface-enter flex max-h-[90vh] w-full ${width} flex-col`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            x
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <footer className="rounded-b-xl border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
