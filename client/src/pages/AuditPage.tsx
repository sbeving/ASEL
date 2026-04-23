import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import type { AuditLog } from '../lib/types';

interface AuditPage {
  logs: AuditLog[];
  nextCursor: string | null;
}

export function AuditPage() {
  const pages = useInfiniteQuery<AuditPage>({
    queryKey: ['audit'],
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<AuditPage>('/audit', {
          params: { limit: 100, cursor: pageParam || undefined },
        })
      ).data,
  });

  const logs = (pages.data?.pages ?? []).flatMap((p) => p.logs);

  return (
    <>
      <PageHeader title="Journal d’audit" subtitle={`${logs.length} événements chargés`} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Utilisateur</th>
              <th className="th">Action</th>
              <th className="th">Entité</th>
              <th className="th">IP</th>
              <th className="th">Détails</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="td text-slate-500 whitespace-nowrap">{dateTime(l.createdAt)}</td>
                <td className="td">{l.username ?? '—'}</td>
                <td className="td"><span className="badge-info">{l.action}</span></td>
                <td className="td text-slate-500">
                  {l.entity ? `${l.entity}${l.entityId ? ` · ${l.entityId.slice(-6)}` : ''}` : '—'}
                </td>
                <td className="td text-slate-500 font-mono text-xs">{l.ip ?? ''}</td>
                <td className="td text-slate-500 max-w-md truncate">
                  {l.details ? JSON.stringify(l.details) : ''}
                </td>
              </tr>
            ))}
            {!pages.isLoading && logs.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>Aucun événement.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <button
            className="btn-secondary"
            onClick={() => pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      )}
    </>
  );
}
