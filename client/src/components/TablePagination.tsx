import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '../lib/types';

export function TablePagination({
  meta,
  onPageChange,
  className,
}: {
  meta?: PageMeta;
  onPageChange: (nextPage: number) => void;
  className?: string;
}) {
  if (!meta) return null;

  return (
    <div className={className ?? 'mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'}>
      <div className="text-center text-xs font-medium text-slate-500 sm:text-left">
        {meta.total === 0
          ? 'Aucun resultat'
          : `${(meta.page - 1) * meta.pageSize + 1} - ${Math.min(meta.page * meta.pageSize, meta.total)} / ${meta.total}`}
      </div>
      <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2 sm:flex sm:justify-end">
        <button
          type="button"
          className="btn-secondary !min-h-[44px] !px-2.5 !py-1.5"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
          aria-label="Page precedente"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-center text-xs font-semibold text-slate-600">
          Page {meta.page} / {meta.totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary !min-h-[44px] !px-2.5 !py-1.5"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
          aria-label="Page suivante"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
