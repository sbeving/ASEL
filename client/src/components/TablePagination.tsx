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
    <div className={className ?? 'mt-3 flex flex-wrap items-center justify-between gap-3'}>
      <div className="text-xs text-slate-500">
        {meta.total === 0
          ? 'Aucun resultat'
          : `${(meta.page - 1) * meta.pageSize + 1} - ${Math.min(meta.page * meta.pageSize, meta.total)} / ${meta.total}`}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary !py-1.5 !px-2.5"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          Prec
        </button>
        <span className="text-xs text-slate-600">
          Page {meta.page} / {meta.totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary !py-1.5 !px-2.5"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Suiv
        </button>
      </div>
    </div>
  );
}
