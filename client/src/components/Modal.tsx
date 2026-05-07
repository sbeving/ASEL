import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  placement?: 'default' | 'top';
  bodyClassName?: string;
}

export function Modal({ open, title, onClose, children, footer, size = 'md', placement = 'default', bodyClassName = '' }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : size === 'xl' ? 'max-w-6xl' : 'max-w-xl';
  const alignment = placement === 'top' ? 'items-start sm:items-start' : 'items-end sm:items-center';
  const radius = placement === 'top' ? 'rounded-b-lg sm:rounded-lg' : 'rounded-t-lg sm:rounded-lg';
  return createPortal(
    <div className={`fixed inset-0 z-[130] flex ${alignment} justify-center overflow-y-auto bg-slate-950/55 p-0 backdrop-blur-sm sm:p-6`}>
      <div
        className={`surface-enter flex max-h-[96dvh] w-full ${width} flex-col overflow-hidden ${radius} border border-surface-200 bg-white shadow-2xl dark:border-surface-700 dark:bg-surface-900 sm:max-h-[92vh]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="flex items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-800 sm:px-5">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-surface-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-white"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 ${bodyClassName}`}>{children}</div>
        {footer && <footer className="border-t border-surface-200 bg-surface-50 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 dark:border-surface-800 dark:bg-surface-950 sm:px-5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
