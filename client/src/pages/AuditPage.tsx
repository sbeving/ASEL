import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import type { AuditLog } from '../lib/types';

export function AuditPage() {
  const logs = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await api.get<{ logs: AuditLog[] }>('/audit', { params: { limit: 300 } })).data.logs,
  });

  return (
    <>
      <PageHeader title="Journal d’audit" subtitle="Événements sensibles" />
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
            {(logs.data ?? []).map((l) => (
              <tr key={l._id}>
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
            {!logs.isLoading && (logs.data?.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>Aucun événement.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
